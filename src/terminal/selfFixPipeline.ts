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
    if (exact === 1) { cur.content = cur.content.replace(search, () => replace); continue; }
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
  if (f.status === "edited" && f.previous.length > 400 && f.content.length < f.previous.length * 0.5) {
    out.push(`The new ${f.path} is less than half its old size, which looks cut off.`);
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
You may also name one new file to create if the change truly needs it.
Reply with ONLY JSON like {"files":["src/components/Example.tsx"]} and nothing else.`;

export function pickUserPrompt(request: string, paths: string[]): string {
  return `Jenny's request:\n${request}\n\nFiles you can read (path):\n${paths.join("\n")}`;
}

export const EDIT_SYSTEM = `You are Wilson, editing your own source code (React + TypeScript + Vite). Jenny, the Architect, asked for a change and will review it before it goes live.
Make the smallest correct change. Keep the existing style. Do not touch anything she did not ask about.
Reply in EXACTLY this format and nothing else:

TITLE: a short title (under 8 words)
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

Rules: SEARCH must copy the current file exactly (same spaces). Never write "rest of code" or "..." placeholders. Only src/ and public/ paths. The last line must be DONE.`;

export function editUserPrompt(request: string, files: SourceFile[], feedback?: string): string {
  const parts = files.map((f) => f.exists
    ? `FILE: ${f.path}\n----- current contents -----\n${f.content}\n----- end of ${f.path} -----`
    : `FILE: ${f.path}\n(does not exist yet; create it with NEW FILE if needed)`);
  return `Jenny's request:\n${request}\n\n${parts.join("\n\n")}${feedback ? `\n\nYour last attempt could not be applied:\n${feedback}\nTry again with SEARCH parts copied exactly from the current contents above.` : ""}`;
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
