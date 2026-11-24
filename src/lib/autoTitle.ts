/**
 * One-shot auto-generated thread titles for the left thread list.
 * Uses the existing chat backend with a tiny prompt. Failures keep the old title.
 */
import type { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import type { StoredThread } from "../memory/LocalMemory";

export const TITLE_SYSTEM =
  "Write a short topic title for this chat. Rules: 2 to 6 words, Title Case, no quotation marks, no emoji, no trailing punctuation, no preamble. Reply with the title alone.";

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

/** Strip model fluff and return a 2–6 word Title Case name, or null if it isn't usable. */
export function normalizeThreadTitle(raw: string): string | null {
  let t = (raw || "").trim().split(/\n/)[0] ?? "";
  t = t.replace(/^title\s*:\s*/i, "");
  t = t.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "");
  t = t.replace(EMOJI_RE, "");
  t = t.replace(/[*_#`]+/g, "").replace(/[.!?…]+$/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const words = t.split(" ").filter(Boolean).slice(0, 6);
  if (words.length < 2) return null;
  const titled = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  if (titled.length < 2 || titled.length > 60) return null;
  return titled;
}

/** Ready after Wilson's 2nd reply (greeting + two answers, and two user messages). */
export function shouldAutoTitle(thread: StoredThread): boolean {
  if (thread.autoTitled || thread.titleLocked) return false;
  const users = thread.messages.filter((m) => m.role === "user").length;
  const assistants = thread.messages.filter((m) => m.role === "assistant").length;
  return users >= 2 && assistants >= 3;
}

/** Prefer a user-renamed title, then an auto title, then whoever is newer. */
export function pickMergedTitle(
  a: StoredThread,
  b: StoredThread,
  newer: StoredThread,
): Pick<StoredThread, "title" | "titleLocked" | "autoTitled"> {
  if (a.titleLocked && !b.titleLocked) return { title: a.title, titleLocked: true, autoTitled: a.autoTitled };
  if (b.titleLocked && !a.titleLocked) return { title: b.title, titleLocked: true, autoTitled: b.autoTitled };
  if (a.titleLocked && b.titleLocked) {
    return { title: newer.title, titleLocked: true, autoTitled: newer.autoTitled };
  }
  if (a.autoTitled && !b.autoTitled) return { title: a.title, titleLocked: false, autoTitled: true };
  if (b.autoTitled && !a.autoTitled) return { title: b.title, titleLocked: false, autoTitled: true };
  return { title: newer.title, titleLocked: false, autoTitled: !!(a.autoTitled || b.autoTitled) };
}

export async function generateThreadTitle(
  adapter: OpenRouterAdapter,
  thread: StoredThread,
): Promise<string | null> {
  const convo = thread.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-12)
    .map((m) => `${m.role === "user" ? "USER" : "WILSON"}: ${m.content.replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");
  if (!convo.trim()) return null;
  try {
    const r = await adapter.generate({
      systemContext: TITLE_SYSTEM,
      userInput: `Chat:\n${convo}\n\nTitle:`,
      generation: { temperature: 0.2, maxTokens: 20 },
      metadata: { task: "title" },
    });
    return normalizeThreadTitle(r.text || "");
  } catch {
    return null;
  }
}

const inFlight = new Set<string>();

/** Generate once, then set autoTitled. No-ops on lock, in-flight, or a bad/failed title. */
export async function maybeApplyAutoTitle(
  adapter: OpenRouterAdapter,
  thread: StoredThread,
  apply: (id: string, title: string) => void,
): Promise<void> {
  if (!shouldAutoTitle(thread) || inFlight.has(thread.id)) return;
  inFlight.add(thread.id);
  try {
    const title = await generateThreadTitle(adapter, thread);
    if (title) apply(thread.id, title);
  } finally {
    inFlight.delete(thread.id);
  }
}
