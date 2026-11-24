/**
 * On-demand thread recaps, saved on the thread and shown in the chat.
 * Uses the same Wilson-proxy generate() path as auto-titles (metadata.task
 * marks a background call; the proxy strips it and adds no extra context).
 * Failures leave the previous summary and title untouched.
 */
import type { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import type { StoredMessage, StoredThread } from "../memory/LocalMemory";
import { normalizeThreadTitle } from "./autoTitle.ts";

export const SUMMARY_SYSTEM =
  "You are Wilson, companion of The Only One. Imagination becomes intelligence.\n\n" +
  "Write a short recap of this chat. Rules:\n" +
  "- 3 to 6 bullet lines, each starting with \"- \"\n" +
  "- Cover main points, decisions, and open next steps; skip a section if nothing fits\n" +
  "- No preamble, no closing, no emoji, no quotation marks around the whole reply\n" +
  "- After the bullets, one line: TITLE: <2 to 6 word Title Case topic>\n" +
  "Reply with the bullets and the TITLE line only.";

export const CHUNK_SYSTEM =
  "You are Wilson. Write a short recap of this part of a longer chat. " +
  "3 to 5 bullet lines starting with \"- \". Cover main points, decisions, and open next steps if present. " +
  "No preamble, no emoji, no TITLE line.";

export const MERGE_SYSTEM =
  "You are Wilson, companion of The Only One. Imagination becomes intelligence.\n\n" +
  "Combine these partial recaps of one chat into a single short recap. Rules:\n" +
  "- 3 to 6 bullet lines, each starting with \"- \"\n" +
  "- Cover main points, decisions, and open next steps; skip a section if nothing fits\n" +
  "- No preamble, no closing, no emoji\n" +
  "- After the bullets, one line: TITLE: <2 to 6 word Title Case topic>\n" +
  "Reply with the bullets and the TITLE line only.";

export const MAX_MSG_CHARS = 360;
export const MAX_CHUNK_CHARS = 7000;
export const MAX_SUMMARY_CHARS = 1600;
export const MAX_CHUNKS = 4;

export function compactMessage(m: StoredMessage, maxChars = MAX_MSG_CHARS): string {
  const who = m.role === "user" ? "USER" : "WILSON";
  const text = (m.content || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
  return `${who}: ${text}`;
}

export function conversationMessages(thread: StoredThread): StoredMessage[] {
  return thread.messages.filter((m) => m.role === "user" || m.role === "assistant");
}

export function transcriptOf(messages: StoredMessage[], perMsg = MAX_MSG_CHARS): string {
  return messages.map((m) => compactMessage(m, perMsg)).join("\n");
}

/** Split a long chat into char-budgeted chunks. Overflow past MAX_CHUNKS keeps the start and the most recent end. */
export function chunkConversation(
  messages: StoredMessage[],
  maxChunkChars = MAX_CHUNK_CHARS,
  perMsg = MAX_MSG_CHARS,
  maxChunks = MAX_CHUNKS,
): StoredMessage[][] {
  const chunks: StoredMessage[][] = [];
  let cur: StoredMessage[] = [];
  let size = 0;
  for (const m of messages) {
    const len = compactMessage(m, perMsg).length + 1;
    if (cur.length && size + len > maxChunkChars) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(m);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  if (chunks.length <= maxChunks) return chunks;
  return [chunks[0], ...chunks.slice(-(maxChunks - 1))];
}

/** Drop model fluff and a trailing TITLE line; keep a short recap or return null. */
export function normalizeSummary(raw: string): string | null {
  let t = (raw || "").trim();
  if (!t) return null;
  t = t.replace(/^```[a-zA-Z0-9]*\s*/, "").replace(/\s*```$/, "").trim();
  t = t.replace(/^(here(?:'s| is)(?: a| the)? (?:short )?recap(?: of this chat)?[:\s]*)/i, "");
  t = t.replace(/^(summary|recap)\s*:\s*/i, "");
  const lines = t
    .split(/\n/)
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => !/^TITLE:\s*/i.test(l.trim()));
  const kept: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    kept.push(s.replace(/^[*•]\s+/, "- "));
  }
  const out = kept.join("\n").trim();
  if (out.length < 8) return null;
  return out.length > MAX_SUMMARY_CHARS ? out.slice(0, MAX_SUMMARY_CHARS).trimEnd() : out;
}

export function extractTitleLine(raw: string): string | null {
  const m = (raw || "").match(/^TITLE:\s*(.+)$/im);
  return m ? normalizeThreadTitle(m[1] || "") : null;
}

/** Enough conversation to recap: at least one user turn and one reply. */
export function shouldSummarize(thread: StoredThread): boolean {
  const users = thread.messages.filter((m) => m.role === "user").length;
  const assistants = thread.messages.filter((m) => m.role === "assistant").length;
  return users >= 1 && assistants >= 1;
}

export type SummaryResult = { summary: string; title: string | null };

export function applySummaryResult(
  thread: StoredThread,
  result: SummaryResult,
  now = new Date().toISOString(),
): StoredThread {
  const next: StoredThread = { ...thread, summary: result.summary, summaryAt: now };
  if (!thread.titleLocked && result.title) {
    next.title = result.title;
    next.autoTitled = true;
    next.titleAtCount = thread.messages.length;
  }
  return next;
}

/** Prefer a dated summary; keep one if the other side has none. */
export function pickMergedSummary(
  a: StoredThread,
  b: StoredThread,
): Pick<StoredThread, "summary" | "summaryAt"> {
  if (a.summary && !b.summary) return { summary: a.summary, summaryAt: a.summaryAt };
  if (b.summary && !a.summary) return { summary: b.summary, summaryAt: b.summaryAt };
  if (!a.summary && !b.summary) return {};
  const atA = Date.parse(a.summaryAt || "") || 0;
  const atB = Date.parse(b.summaryAt || "") || 0;
  const newer = atB > atA ? b : a;
  return { summary: newer.summary, summaryAt: newer.summaryAt };
}

async function complete(
  adapter: OpenRouterAdapter,
  systemContext: string,
  userInput: string,
  maxTokens: number,
): Promise<string | null> {
  try {
    const r = await adapter.generate({
      systemContext,
      userInput,
      generation: { temperature: 0.2, maxTokens },
      metadata: { task: "summary" },
    });
    const text = (r.text || "").trim();
    return text || null;
  } catch {
    return null;
  }
}

export type SummaryOpts = { maxChunkChars?: number; perMsg?: number; maxChunks?: number };

export async function generateThreadSummary(
  adapter: OpenRouterAdapter,
  thread: StoredThread,
  opts: SummaryOpts = {},
): Promise<SummaryResult | null> {
  const messages = conversationMessages(thread);
  if (!messages.length) return null;
  const chunks = chunkConversation(
    messages,
    opts.maxChunkChars ?? MAX_CHUNK_CHARS,
    opts.perMsg ?? MAX_MSG_CHARS,
    opts.maxChunks ?? MAX_CHUNKS,
  );
  let raw: string | null;
  if (chunks.length <= 1) {
    const convo = transcriptOf(chunks[0] || messages);
    if (!convo.trim()) return null;
    raw = await complete(adapter, SUMMARY_SYSTEM, `Chat:\n${convo}\n\nRecap:`, 420);
  } else {
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const convo = transcriptOf(chunks[i]);
      const part = await complete(
        adapter,
        CHUNK_SYSTEM,
        `Part ${i + 1} of ${chunks.length}:\n${convo}\n\nRecap:`,
        280,
      );
      if (!part) return null;
      const norm = normalizeSummary(part);
      if (!norm) return null;
      parts.push(norm);
    }
    raw = await complete(
      adapter,
      MERGE_SYSTEM,
      `Partial recaps:\n\n${parts.map((p, i) => `Part ${i + 1}:\n${p}`).join("\n\n")}\n\nRecap:`,
      420,
    );
  }
  if (!raw) return null;
  const summary = normalizeSummary(raw);
  if (!summary) return null;
  return { summary, title: extractTitleLine(raw) };
}

const inFlight = new Set<string>();

export function isSummarizing(id: string): boolean {
  return inFlight.has(id);
}

export async function requestThreadSummary(
  adapter: OpenRouterAdapter,
  thread: StoredThread,
  apply: (id: string, result: SummaryResult) => void,
): Promise<"ok" | "busy" | "fail"> {
  if (inFlight.has(thread.id)) return "busy";
  inFlight.add(thread.id);
  try {
    const result = await generateThreadSummary(adapter, thread);
    if (!result) return "fail";
    apply(thread.id, result);
    return "ok";
  } catch {
    return "fail";
  } finally {
    inFlight.delete(thread.id);
  }
}
