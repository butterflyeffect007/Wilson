/**
 * Self-fix proposal pipeline (pure, no network): parse Wilson's edit reply, apply targeted
 * SEARCH/REPLACE edits to the real file contents, validate the result, and build a readable diff.
 * Kept free of imports so it can be unit-tested directly with `node --test`.
 */

export type PipelineDiffLine = { kind: "ctx" | "del" | "add" | "file"; text: string };

export type EditBlock =
  | { path: string; kind: "replace"; search: string; replace: string }
  | { path: string; kind: "create"; content: string };

export type ParsedReply = {
  title: string;
  summary: string;
  edits: EditBlock[];
  /** true only when the reply ends with the DONE marker (otherwise it was cut off). */
  complete: boolean;
  problems: string[];
};

export type SourceFile = { path: string; content: string; exists: boolean; sha?: string | null };
export type ChangedFile = {
  path: string;
  status: "edited" | "added";
  content: string;
  previous: string;
  baseSha?: string | null;
};

export const DONE_MARKER = "DONE";
export const MAX_FILES_PER_FIX = 4;

const SEARCH_RE = /^<{5,9}\s*SEARCH\s*$/;
const DIVIDER_RE = /^={5,9}\s*$/;
const REPLACE_RE = /^>{5,9}\s*REPLACE\s*$/;
const NEW_RE = /^<{5,9}\s*NEW\s*FILE\s*$/i;
const END_NEW_RE = /^>{5,9}\s*END\s*$/i;
const FILE_RE = /^\s*(?:\*\*)?FILE:\s*`?([^`*\s]+)`?(?:\*\*)?\s*$/i;
const FENCE_RE = /^\s*```[\w-]*\s*$/;

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

export function cleanPath(raw: string): string {
  return raw.trim().replace(/^[`'"]+|[`'"]+$/g, "").replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

/** Mirrors the worker's write rules so we never propose something it will refuse. */
export function isWritablePath(raw: string): boolean {
  const p = cleanPath(raw);
  if (!p || p.includes("\0") || p.includes("//")) return false;
  if (p.split("/").some((part) => part === ".." || part === "." || part === ".git")) return false;
  if (!/^(src|public)\//.test(p)) return false;
  if (/(^|\/)(\.github|workers)(\/|$)/.test(p)) return false;
  if (/(^|\/)wrangler\.toml$/i.test(p) || /(^|\/)\.env($|\.)/i.test(p)) return false;
  if (/token|secret|credential/i.test(p)) return false;
  return true;
}

/** Wilson's first answer: which files he needs to read. Accepts JSON or plain path lines. */
export function parseFilePick(text: string, available: string[]): string[] {
  const avail = new Set(available);
  const found: string[] = [];
  const add = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const p = cleanPath(raw);
    if (!p || found.includes(p)) return;
    if (avail.has(p) || (isWritablePath(p) && /\.[a-z0-9]+$/i.test(p))) found.push(p);
  };
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) {
    try {
      const obj = JSON.parse(m[0]) as { files?: unknown };
      if (Array.isArray(obj.files)) obj.files.forEach(add);
    } catch { /* fall through to line scan */ }
  }
  if (!found.length) {
    for (const hit of text.matchAll(/(?:^|[\s"'`(])((?:src|public)\/[\w./@+-]+\.[A-Za-z0-9]+)/g)) add(hit[1]);
  }
  return found.slice(0, MAX_FILES_PER_FIX);
}

/** Parse the edit reply. Format:
 *  TITLE: …  /  SUMMARY: …  /  FILE: path  then  <<<<<<< SEARCH … ======= … >>>>>>> REPLACE
 *  (or <<<<<<< NEW FILE … >>>>>>> END for a brand-new file), ending with a line that says DONE. */
export function parseEditReply(raw: string): ParsedReply {
  const lines = normalizeNewlines(raw).split("\n");
  const out: ParsedReply = { title: "", summary: "", edits: [], complete: false, problems: [] };
  let path = "";
  let i = 0;
  let lastMeaningful = "";
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t) lastMeaningful = t;
    const title = /^\s*(?:\*\*)?TITLE:(?:\*\*)?\s*(.+)$/i.exec(line);
    const summary = /^\s*(?:\*\*)?SUMMARY:(?:\*\*)?\s*(.+)$/i.exec(line);
    const file = FILE_RE.exec(line);
    if (title && !out.title) { out.title = title[1].trim().replace(/\*\*$/, ""); i++; continue; }
    if (summary && !out.summary) { out.summary = summary[1].trim().replace(/\*\*$/, ""); i++; continue; }
    if (file) { path = cleanPath(file[1]); i++; continue; }
    if (SEARCH_RE.test(t)) {
      const search: string[] = [];
      const replace: string[] = [];
      let j = i + 1;
      while (j < lines.length && !DIVIDER_RE.test(lines[j].trim())) search.push(lines[j++]);
      if (j >= lines.length) { out.problems.push("An edit was cut off before its ======= line."); break; }
      j++;
      while (j < lines.length && !REPLACE_RE.test(lines[j].trim())) replace.push(lines[j++]);
      if (j >= lines.length) { out.problems.push("An edit was cut off before its >>>>>>> REPLACE line."); break; }
      if (!path) out.problems.push("An edit came without a FILE: line.");
      else out.edits.push({ path, kind: "replace", search: search.join("\n"), replace: replace.join("\n") });
      lastMeaningful = ">>>>>>> REPLACE";
      i = j + 1;
      continue;
    }
    if (NEW_RE.test(t)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !END_NEW_RE.test(lines[j].trim())) body.push(lines[j++]);
      if (j >= lines.length) { out.problems.push("A new file was cut off before its >>>>>>> END line."); break; }
      if (!path) out.problems.push("A new file came without a FILE: line.");
      else out.edits.push({ path, kind: "create", content: body.join("\n") });
      lastMeaningful = ">>>>>>> END";
      i = j + 1;
      continue;
    }
    if (FENCE_RE.test(line)) { i++; continue; }
    i++;
  }
  out.complete = lastMeaningful.replace(/[`*.!\s]/g, "").toUpperCase() === DONE_MARKER && !out.problems.length;
  if (!out.complete && !out.problems.length) out.problems.push("The reply stopped before the DONE line, so it may be cut off.");
  if (!out.edits.length) out.problems.push("No edits were found in the reply.");
  return out;
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) { n++; at = hay.indexOf(needle, at + needle.length); }
  return n;
}

/** Find `search` as a run of whole lines, ignoring trailing (then all) whitespace differences. */
function fuzzyLineMatch(content: string, search: string): { start: number; end: number; count: number } {
  const hay = content.split("\n");
  const needle = search.split("\n");
  while (needle.length && !needle[needle.length - 1].trim()) needle.pop();
  while (needle.length && !needle[0].trim()) needle.shift();
  if (!needle.length) return { start: -1, end: -1, count: 0 };
  for (const norm of [(s: string) => s.trimEnd(), (s: string) => s.trim().replace(/\s+/g, " ")]) {
    const n = needle.map(norm);
    const hits: number[] = [];
    for (let i = 0; i + n.length <= hay.length; i++) {
      let ok = true;
      for (let k = 0; k < n.length; k++) if (norm(hay[i + k]) !== n[k]) { ok = false; break; }
      if (ok) hits.push(i);
    }
    if (hits.length) return { start: hits[0], end: hits[0] + n.length, count: hits.length };
  }
  return { start: -1, end: -1, count: 0 };
}

function reindent(replace: string, from: string, to: string): string {
  // When the model dropped indentation, shift its replacement to match the real lines.
  const lead = (s: string) => (/^[ \t]*/.exec(s.split("\n").find((l) => l.trim()) || "") || [""])[0];
  const a = lead(from), b = lead(to);
  if (a === b) return replace;
  return replace.split("\n").map((l) => (l.trim() ? (l.startsWith(a) ? b + l.slice(a.length) : b + l.trimStart()) : l)).join("\n");
}

export type ApplyResult = { files: ChangedFile[]; problems: string[] };

/** Apply edits to real file contents. Every SEARCH must match exactly one place. */
export function applyEdits(sources: SourceFile[], edits: EditBlock[]): ApplyResult {
  const problems: string[] = [];
  const byPath = new Map<string, SourceFile>();
  for (const s of sources) byPath.set(cleanPath(s.path), s);
  const working = new Map<string, { content: string; crlf: boolean; src?: SourceFile; created: boolean }>();
  for (const e of edits) {
    const path = cleanPath(e.path);
    if (!isWritablePath(path)) { problems.push(`${path} is outside src/ and public/, so I can't change it.`); continue; }
    const src = byPath.get(path);
    let cur = working.get(path);
    if (!cur) {
      const orig = src && src.exists ? src.content : "";
      cur = { content: normalizeNewlines(orig), crlf: /\r\n/.test(orig), src, created: !(src && src.exists) };
      working.set(path, cur);
    }
    if (e.kind === "create") {
      if (src && src.exists) { problems.push(`${path} already exists; it needs SEARCH/REPLACE edits, not a new file.`); continue; }
      cur.content = normalizeNewlines(e.content);
      continue;
    }
    const search = normalizeNewlines(e.search);
    const replace = normalizeNewlines(e.replace);
    if (!src || !src.exists) {
      if (!search.trim() && cur.created) { cur.content = replace; continue; }
      problems.push(`${path} doesn't exist yet, so there's nothing to search in.`);
      continue;
    }
    if (!search.trim()) { problems.push(`An edit to ${path} has an empty SEARCH part.`); continue; }
    const exact = countOccurrences(cur.content, search);
    if (exact === 1) {
      if (cur.content.length > 1000 && search.length > 200 && replace.length < search.length * 0.5) {
        problems.push(`That edit would remove too much of ${path}. Add a small new block instead of replacing a large section.`);
        continue;
      }
      cur.content = cur.content.replace(search, () => replace); continue;
    }
    if (exact > 1) { problems.push(`A SEARCH part matches ${exact} places in ${path}. It needs a few more unique lines.`); continue; }
    const fuzzy = fuzzyLineMatch(cur.content, search);
    if (fuzzy.count === 1) {
      const hay = cur.content.split("\n");
      const original = hay.slice(fuzzy.start, fuzzy.end).join("\n");
      const fixed = reindent(replace.replace(/^\n+|\n+$/g, ""), search.replace(/^\n+/, ""), original);
      hay.splice(fuzzy.start, fuzzy.end - fuzzy.start, ...fixed.split("\n"));
      cur.content = hay.join("\n");
      continue;
    }
    if (fuzzy.count > 1) { problems.push(`A SEARCH part matches ${fuzzy.count} places in ${path}. It needs a few more unique lines.`); continue; }
    const first = search.split("\n").find((l) => l.trim()) || "";
    problems.push(`Couldn't find this in ${path}: "${first.trim().slice(0, 80)}". The SEARCH part must copy the current lines exactly.`);
  }
  const files: ChangedFile[] = [];
  for (const [path, w] of working) {
    const previous = w.src && w.src.exists ? w.src.content : "";
    const content = w.crlf ? w.content.replace(/\n/g, "\r\n") : w.content;
    if (content === previous) continue;
    files.push({ path, status: w.created ? "added" : "edited", content, previous, baseSha: w.src?.sha ?? null });
  }
  return { files, problems };
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|css|json)$/i;
const PLACEHOLDER_RE = /(\.\.\.|…)\s*(rest of|existing|unchanged|remaining|same as before|keep (the )?(rest|existing))|\/\/\s*(rest of|existing) (the )?(code|file)|\(rest of (the )?file\)/i;

function bracketBalance(s: string): [number, number, number] {
  let a = 0, b = 0, c = 0;
  for (const ch of s) {
    if (ch === "{") a++; else if (ch === "}") a--;
    else if (ch === "(") b++; else if (ch === ")") b--;
    else if (ch === "[") c++; else if (ch === "]") c--;
  }
  return [a, b, c];
}

/** Refuse anything that looks empty, truncated, or half-written. */
export function validateChange(f: ChangedFile): string[] {
  const out: string[] = [];
  if (!f.content.trim()) { out.push(`The new ${f.path} would be empty.`); return out; }
  if (f.status === "edited" && f.previous.length > 200 && f.content.length < f.previous.length * 0.8) {
    out.push(`The new ${f.path} is much smaller than the current file, which looks cut off.`);
  }
  if (/\.css$/i.test(f.path) && /@tailwind\s+base/.test(f.previous) && !/@tailwind\s+base/.test(f.content)) {
    out.push(`The new ${f.path} would throw away the existing stylesheet instead of adding the effect.`);
  }
  const added = lineDiff(f.path, f.previous, f.content).filter((l) => l.kind === "add").map((l) => l.text).join("\n");
  if (PLACEHOLDER_RE.test(added)) out.push(`The change to ${f.path} has a "rest of the code" placeholder instead of real code.`);
  if (CODE_EXT.test(f.path)) {
    const before = f.status === "edited" ? bracketBalance(f.previous) : [0, 0, 0];
    const after = bracketBalance(f.content);
    if (before[0] !== after[0] || before[1] !== after[1] || before[2] !== after[2]) {
      out.push(`The brackets in ${f.path} no longer match up, so it may be unfinished.`);
    }
  }
  if (/\.json$/i.test(f.path)) {
    try { JSON.parse(f.content); } catch { out.push(`${f.path} would not be valid JSON.`); }
  }
  return out;
}

const RELEVANCE_STOP = new Set(("the a an and or to of for in on it me my i you your please just can could would will that this with do did make add change fix update want wanted like about him his he she we they is are be been being from as at by not no yes so if then than too very more most some any all also only own self into over after before again still now here there what which who when how why something somehow should shall may might have has had get got let").split(" "));

function contentWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !RELEVANCE_STOP.has(w));
}

function wordHit(needle: string, hay: Set<string>): boolean {
  if (hay.has(needle)) return true;
  for (const h of hay) if (h.includes(needle) || needle.includes(h)) return true;
  return false;
}

/** Refuse a proposal that does not actually do what Jenny asked (e.g. a random cleanup when she asked for a shimmer). */
export function relevanceProblems(request: string, change: {
  title: string;
  summary: string;
  files: { path: string; status: string }[];
  diff: PipelineDiffLine[];
}): string[] {
  const req = contentWords(request);
  if (!req.length) return [];
  const changeText = [
    change.title || "",
    change.summary || "",
    ...change.files.map((f) => f.path),
    ...change.diff.filter((d) => d.kind === "add" || d.kind === "file").map((d) => d.text),
  ].join("\n");
  const hay = new Set(contentWords(changeText));
  const distinctive = req.filter((w) => w.length >= 5 || /shimmer|glow|sparkle|orb|button|title|footer|header|font|color|colour|theme|animat|chat/.test(w));
  const missed = (distinctive.length ? distinctive : req).filter((w) => !wordHit(w, hay));
  const problems: string[] = [];
  const pool = distinctive.length ? distinctive : req;
  if (pool.length && missed.length === pool.length) {
    problems.push(`The change doesn't match what you asked for (${missed.slice(0, 5).join(", ")}).`);
  }
  const hasAdd = change.diff.some((d) => d.kind === "add");
  const hasDel = change.diff.some((d) => d.kind === "del");
  if (/\b(add|put|give|include|create)\b/i.test(request) && hasDel && !hasAdd) {
    problems.push("You asked to add something, but this change only removes code.");
  }
  if (/\b(shimmer|sparkle|glow|shine|glitter)\b/i.test(request)) {
    const added = change.diff.filter((d) => d.kind === "add").map((d) => d.text).join("\n");
    const hasStyle = /@keyframes|animation\s*:/.test(added);
    if (!hasStyle) {
      problems.push("You asked for a visible effect, but this only adds a class name and no CSS animation or style. Add the actual style (for example @keyframes) too.");
    }
  }
  return problems;
}

/** Line diff with 3 lines of context; long unchanged stretches fold into "⋯". */
export function lineDiff(path: string, before: string, after: string, context = 3): PipelineDiffLine[] {
  const a = normalizeNewlines(before).split("\n");
  const b = normalizeNewlines(after).split("\n");
  if (!before) a.length = 0;
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  type Op = { kind: "ctx" | "del" | "add"; text: string };
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ kind: "ctx", text: a[i] });
  if (am.length * bm.length > 2_500_000) {
    am.forEach((t) => ops.push({ kind: "del", text: t }));
    bm.forEach((t) => ops.push({ kind: "add", text: t }));
  } else {
    const n = am.length, m = bm.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { ops.push({ kind: "ctx", text: am[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ kind: "del", text: am[i++] });
      else ops.push({ kind: "add", text: bm[j++] });
    }
    while (i < n) ops.push({ kind: "del", text: am[i++] });
    while (j < m) ops.push({ kind: "add", text: bm[j++] });
  }
  for (let i = a.length - suf; i < a.length; i++) ops.push({ kind: "ctx", text: a[i] });

  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.kind === "ctx") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: PipelineDiffLine[] = [{ kind: "file", text: path }];
  let gap = false;
  ops.forEach((op, idx) => {
    if (keep[idx]) { out.push(op); gap = false; }
    else if (!gap) { out.push({ kind: "ctx", text: "⋯" }); gap = true; }
  });
  if (out.length > 1 && out[out.length - 1].text === "⋯") out.pop();
  if (out.length > 1 && out[1].text === "⋯") out.splice(1, 1);
  return out;
}

export function diffForFiles(files: ChangedFile[], maxLines = 400): PipelineDiffLine[] {
  const all = files.flatMap((f) => lineDiff(f.path, f.previous, f.content));
  return all.length > maxLines ? [...all.slice(0, maxLines - 1), { kind: "ctx", text: `⋯ ${all.length - maxLines + 1} more lines in the pull request` }] : all;
}

/* ---------------- Prompts ---------------- */

export const PICK_SYSTEM = `You are Wilson, looking at your own source code (a React + TypeScript + Vite app). Jenny, the Architect, wants you to change yourself.
You can only change files under src/ and public/. Pick the files you need to READ to make the change (at most ${MAX_FILES_PER_FIX}, fewest possible).
Prefer the smallest CSS or component that owns that UI (for a title or header look, that is often src/index.css plus the markup in src/App.tsx). Do not pick a huge file if a smaller one will do.
You may also name one new file to create if the change truly needs it.
Reply with ONLY JSON like {"files":["src/components/Example.tsx"]} and nothing else.`;

export function pickUserPrompt(request: string, paths: string[]): string {
  return `Jenny's request:\n${request}\n\nFiles you can read (path):\n${paths.join("\n")}`;
}

export const EDIT_SYSTEM = `You are Wilson, editing your own source code (React + TypeScript + Vite). Jenny, the Architect, asked for a change and will review it before it goes live.
Make the smallest correct change that actually does what she asked. Keep the existing style. Do not touch anything she did not ask about. Do not invent an unrelated cleanup.
Reply in EXACTLY this format and nothing else:

TITLE: a short title in Jenny's own words (under 8 words), not a new invention
SUMMARY: one or two plain sentences saying what changes for Jenny
FILE: path/of/the/file
<<<<<<< SEARCH
the exact current lines to replace, copied character for character, with enough lines to be unique
=======
the new lines
>>>>>>> REPLACE
(repeat FILE + SEARCH/REPLACE blocks as needed; several blocks for one file are fine)

For a brand-new file only:
FILE: path/of/new/file
<<<<<<< NEW FILE
full contents
>>>>>>> END

DONE

Rules: SEARCH must copy the current file exactly (same spaces). Never write "rest of code" or "..." placeholders. Only src/ and public/ paths. The last line must be DONE. The new lines must clearly do what she asked — use her key words (for example a class name like shimmer) so the change is obviously about her request. If she asked for a visible effect (shimmer, sparkle, glow), you must also add the actual CSS (@keyframes and a rule that uses it). A class name with no style is not enough.`;

/** The live worker rejects any single chat message over 8000 characters. Stay under that. */
export const MAX_EDIT_PROMPT_CHARS = 7200;

const EFFECT_WORD = /^(shimmer|sparkle|glow|shine|glitter|animat(?:e|ion|ed)?|iridescent|effect|subtle|tiny|gold)$/;

/** The thing she wants changed (title, header, …) — not the effect word, which often is not in the file yet. */
function subjectHints(request: string): string[] {
  const s: string[] = [];
  if (/\b(title|header|heading|wordmark|logo|brand)\b/i.test(request)) {
    s.push("wl-title", "wl-w", "tracking-[0.28em]", "+ THE ONLY ONE");
  }
  if (/\bheader\b/i.test(request)) s.push("<header", "header ");
  if (/\borb\b/i.test(request)) s.push("wilson-orb", "wl-orb");
  if (/\b(wilson word|the word wilson|WILSON word)\b/i.test(request)) s.push("wl-w", ">WILSON<");
  return s;
}

function lineHasTerm(line: string, term: string): boolean {
  const t = term.toLowerCase();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").test(line);
}

function scoreLine(line: string, request: string): number {
  let s = 0;
  const subjects = subjectHints(request);
  for (const h of subjects) if (lineHasTerm(line, h) || line.includes(h)) s += 8;
  if (lineHasTerm(line, "wl-title") || lineHasTerm(line, "wl-w")) s += 6;
  if (/>WILSON</.test(line) || /className="wl-w/.test(line) || /className="[^"]*wl-title/.test(line)) s += 12;
  if (/\.wl-title\b/.test(line) || /header\s+\.wl-w/.test(line)) s += 12;
  const hasSubject = subjects.length > 0;
  for (const w of contentWords(request)) {
    if (w.length < 4 || !lineHasTerm(line, w)) continue;
    s += hasSubject && EFFECT_WORD.test(w) ? 1 : 4;
  }
  return s;
}

function promptHints(request: string): string[] {
  return [...new Set([...subjectHints(request), ...contentWords(request)])];
}

/** Pack the most relevant exact lines of a (possibly huge) file into a budget, so SEARCH/REPLACE still has real text to copy. */
export function sliceSourceForPrompt(content: string, request: string, budget: number): string {
  const text = normalizeNewlines(content);
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const scores = lines.map((line) => scoreLine(line, request));
  if (!scores.some((s) => s > 0)) {
    for (let i = 0; i < lines.length; i++) {
      if (/(className|header|h1|wl-title|wl-w|WILSON)/i.test(lines[i])) scores[i] = 1;
    }
  }
  const hits = scores.map((s, i) => ({ i, s })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const take = new Array(lines.length).fill(false);
  for (const h of hits) {
    const pad = h.s >= 8 ? 14 : h.s >= 4 ? 3 : 1;
    for (let i = Math.max(0, h.i - pad); i <= Math.min(lines.length - 1, h.i + pad); i++) take[i] = true;
    const marked = take.reduce((n, v, i) => n + (v ? lines[i].length + 1 : 0), 0);
    if (marked > budget * 3) break;
  }
  if (!take.some(Boolean)) {
    const n = Math.min(lines.length, 80);
    for (let i = 0; i < n; i++) take[i] = true;
  }
  const windows: { start: number; end: number; score: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!take[i]) continue;
    const start = i;
    while (i + 1 < lines.length && take[i + 1]) i++;
    let best = start, score = 0;
    for (let j = start; j <= i; j++) if (scores[j] > score) { score = scores[j]; best = j; }
    const MAX_WIN = 28;
    if (i - start + 1 > MAX_WIN) {
      const half = Math.floor(MAX_WIN / 2);
      windows.push({ start: Math.max(start, best - half), end: Math.min(i, best + half), score });
    } else {
      windows.push({ start, end: i, score });
    }
  }
  // Pack the highest-scoring windows first so a later title/header is not dropped for earlier weak hits.
  const ranked = [...windows].sort((a, b) => b.score - a.score);
  const header = `(This file has ${lines.length} lines. Only the most relevant parts are shown. SEARCH must copy the code exactly, with no line numbers and no ellipsis.)`;
  const chosen: { start: number; end: number }[] = [];
  let used = header.length;
  for (const w of ranked) {
    const block = `----- lines ${w.start + 1}-${w.end + 1} -----\n` + lines.slice(w.start, w.end + 1).join("\n");
    if (used + block.length + 2 <= budget) {
      chosen.push({ start: w.start, end: w.end });
      used += block.length + 2;
      continue;
    }
    let best = w.start;
    for (let i = w.start; i <= w.end; i++) if (scores[i] > scores[best]) best = i;
    const label = (a: number, b: number) => `----- lines ${a + 1}-${b + 1} -----\n` + lines.slice(a, b + 1).join("\n");
    let a = best, b = best;
    const room = () => budget - used - label(a, b).length - 2;
    if (room() < 0) continue; // even the best line cannot fit
    while (true) {
      const leftOk = a > w.start && room() >= lines[a - 1].length + 1;
      const rightOk = b < w.end && room() >= lines[b + 1].length + 1;
      if (!leftOk && !rightOk) break;
      if (leftOk && (!rightOk || scores[a - 1] >= scores[b + 1])) a--;
      else if (rightOk) b++;
      else break;
    }
    const slim = label(a, b);
    chosen.push({ start: a, end: b });
    used += slim.length + 2;
  }
  chosen.sort((a, b) => a.start - b.start);
  const chunks: string[] = [header];
  if (!chosen.length) {
    chunks.push(lines.slice(0, Math.min(lines.length, 40)).join("\n").slice(0, Math.max(0, budget - used - 10)));
  } else {
    for (const w of chosen) {
      chunks.push(`----- lines ${w.start + 1}-${w.end + 1} -----\n` + lines.slice(w.start, w.end + 1).join("\n"));
    }
  }
  return chunks.join("\n");
}


export function editUserPrompt(request: string, files: SourceFile[], feedback?: string): string {
  const head = `Jenny's request:\n${request}\n\n`;
  const tail = feedback
    ? `\n\nYour last attempt could not be applied:\n${feedback}\nTry again with SEARCH parts copied exactly from the current contents above.`
    : "";
  const budget = Math.max(1500, MAX_EDIT_PROMPT_CHARS - head.length - tail.length);
  const per = Math.max(900, Math.floor(budget / Math.max(1, files.length)));
  const parts = files.map((f) => {
    if (!f.exists) return `FILE: ${f.path}\n(does not exist yet; create it with NEW FILE if needed)`;
    const body = sliceSourceForPrompt(f.content, request, Math.max(600, per - f.path.length - 80));
    const label = body === normalizeNewlines(f.content) ? "current contents" : "current contents, relevant parts";
    return `FILE: ${f.path}\n----- ${label} -----\n${body}\n----- end of ${f.path} -----`;
  });
  let out = head + parts.join("\n\n") + tail;
  if (out.length > MAX_EDIT_PROMPT_CHARS) {
    const tighter = Math.floor((MAX_EDIT_PROMPT_CHARS - head.length - tail.length) / Math.max(1, files.length)) - 80;
    const slim = files.map((f) => {
      if (!f.exists) return `FILE: ${f.path}\n(does not exist yet; create it with NEW FILE if needed)`;
      const body = sliceSourceForPrompt(f.content, request, Math.max(400, tighter));
      return `FILE: ${f.path}\n----- current contents, relevant parts -----\n${body}\n----- end of ${f.path} -----`;
    });
    out = head + slim.join("\n\n") + tail;
  }
  return out;
}



/** One user message per file, each under the live 8000-char cap, so large files can still be edited. */
export function editPromptMessages(request: string, files: SourceFile[], feedback?: string): { history: { role: "user"; content: string }[]; user: string } {
  const history = files.map((f) => {
    if (!f.exists) return { role: "user" as const, content: `FILE: ${f.path}\n(does not exist yet; create it with NEW FILE if needed)` };
    const body = sliceSourceForPrompt(f.content, request, MAX_EDIT_PROMPT_CHARS - f.path.length - 80);
    const label = body === normalizeNewlines(f.content) ? "current contents" : "current contents, relevant parts";
    return { role: "user" as const, content: `FILE: ${f.path}\n----- ${label} -----\n${body}\n----- end of ${f.path} -----` };
  });
  let hint = "";
  if (/\b(shimmer|sparkle|glow|shine|glitter|title|header)\b/i.test(request)) {
    hint = "\n\nHint: you can only edit src/ and public/ (never index.html or the repo root). For a title or header look, add @keyframes and a class in src/index.css, and put that class on the existing wl-title / wl-w markup in src/App.tsx.";
  }
  const user = `Jenny's request:\n${request}\n\nUse the exact current file contents from the previous messages. SEARCH must copy those lines exactly.`
    + hint
    + (feedback ? `\n\nYour last attempt could not be applied:\n${feedback}\nTry again with SEARCH parts copied exactly from the current contents above.` : "");
  return { history, user };
}


/* ---------------- Status stepper ---------------- */

export type PushStatus = "draft" | "review" | "live" | "declined" | "undone";
export type PublishState = "waiting" | "building" | "publishing" | "live" | "failed" | "superseded";
export type CheckState = "waiting" | "running" | "passed" | "failed";
export type SimpleTone = "work" | "ok" | "warn" | "live" | "done";
export type SimpleStatus = { step: 0 | 1 | 2 | 3; tone: SimpleTone; title: string; text: string; settled: boolean };

/** Plain-words status for the simplified Terminal card (no PR / diff / merge / deploy wording).
 *  step: 0 = proposed, 1 = waiting for you, 2 = going live, 3 = live. */
export function simpleStatus(status: PushStatus | undefined, publish?: PublishState, check?: CheckState): SimpleStatus {
  if (status === "declined") return { step: 0, tone: "done", title: "Declined.", text: "Nothing changed.", settled: true };
  if (status === "undone") {
    if (publish === "live") return { step: 3, tone: "live", title: "Undone. The old version is back.", text: "Close Wilson and open him again to see it.", settled: true };
    if (publish === "failed") return { step: 2, tone: "warn", title: "Undo didn't go live.", text: "The live Wilson still has the change. Ask Wilson to try again.", settled: true };
    return { step: 2, tone: "work", title: "Undoing… putting the old version back.", text: "About 1–2 minutes. You can leave this screen.", settled: false };
  }
  if (status === "live") {
    if (publish === "live") return { step: 3, tone: "live", title: "It's live!", text: "Close Wilson and open him again to see it.", settled: true };
    if (publish === "failed") return { step: 2, tone: "warn", title: "Approved, but it didn't go live.", text: "The live Wilson didn't change. Tap Undo it, or ask Wilson to try again.", settled: true };
    return { step: 2, tone: "work", title: "Approved — putting it live…", text: "About 1–2 minutes. You can leave this screen.", settled: false };
  }
  if (status === "review") {
    if (check === "passed") return { step: 1, tone: "ok", title: "Safety check passed.", text: "Wilson still works with this change. Nothing changes until you approve.", settled: false };
    if (check === "failed") return { step: 1, tone: "warn", title: "Safety check failed.", text: "This change would break Wilson. Best to Decline it.", settled: false };
    return { step: 1, tone: "work", title: "Safety check running…", text: "Wilson is making sure he still works with this change (about a minute). Nothing changes until you approve.", settled: false };
  }
  return { step: 0, tone: "warn", title: "Not sent yet.", text: "Wilson made the change but couldn't send it for its safety check. Tap Try again.", settled: false };
}

export type Stepper = { step: 0 | 1 | 2 | 3; headline: string; detail: string; tone: "work" | "ok" | "warn" | "done" };

/** 0 = proposed, 1 = waiting for you, 2 = live (publishing), 3 = live and published. */
export function stepperFor(status: PushStatus | undefined, publish?: PublishState, check?: CheckState): Stepper {
  if (status === "declined") return { step: 0, headline: "Declined", detail: "Nothing changed. The pull request is closed.", tone: "done" };
  if (status === "undone") {
    if (publish === "live") return { step: 3, headline: "Undone — old version is back", detail: "Close and reopen Wilson to see it.", tone: "ok" };
    if (publish === "failed") return { step: 2, headline: "Undo is merged, publish failed", detail: "Open the pull request link to see why.", tone: "warn" };
    return { step: 2, headline: "Undoing… publishing the old version", detail: "This takes about 1–2 minutes.", tone: "work" };
  }
  if (status === "live") {
    if (publish === "live") return { step: 3, headline: "Live — close and reopen Wilson to see it.", detail: "It's on the live site for everyone.", tone: "ok" };
    if (publish === "failed") return { step: 2, headline: "Merged, but publishing failed", detail: "The live site still has the old version. Tap Undo, or ask Wilson to fix it.", tone: "warn" };
    return { step: 2, headline: "Publishing…", detail: "Approved and merged. GitHub is building the new Wilson (about 1–2 minutes).", tone: "work" };
  }
  if (status === "review") {
    const c = check === "passed" ? "Build check passed ✓" : check === "failed" ? "Build check FAILED — better to Decline" : check === "running" ? "Build check running…" : "Build check starting…";
    return { step: 1, headline: "Waiting for you", detail: `${c}. Nothing changes until you approve.`, tone: check === "failed" ? "warn" : "work" };
  }
  return { step: 0, headline: "Proposed", detail: "Only on this phone so far. Tap Send for review to make a real pull request.", tone: "work" };
}
