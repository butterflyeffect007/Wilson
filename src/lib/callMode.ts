/**
 * "Talk with Wilson" call mode — pure (DOM-free) pieces so they can be tested in Node:
 *  - callReducer: the call's state machine (listening → thinking → speaking → listening …)
 *  - endpointDelay: how long a pause means "she's done talking" (longer after a trailing "and…", "um…")
 *  - isLikelyEcho / shouldBargeIn: on browsers that can listen while he talks, ignore his own voice coming
 *    back through the mic and only stop him when she really says something.
 */

export type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "paused" | "ended" | "error";

export interface CallState {
  phase: CallPhase;
  /** What she has said so far this turn (live transcript). */
  heard: string;
  /** Completed back-and-forth turns this call. */
  turns: number;
  error?: string;
}

export type CallEvent =
  | { type: "MIC_READY" }
  | { type: "MIC_DENIED"; message: string }
  | { type: "HEARD"; text: string }
  | { type: "TURN_END"; text: string }
  | { type: "REPLY_STARTED" }
  | { type: "REPLY_DONE" }
  | { type: "INTERRUPT" }
  | { type: "IDLE_TIMEOUT" }
  | { type: "RESUME" }
  | { type: "END" };

export const initialCallState: CallState = { phase: "connecting", heard: "", turns: 0 };

export function callReducer(s: CallState, e: CallEvent): CallState {
  if (s.phase === "ended") return s; // a finished call never comes back to life
  if (e.type === "END") return { ...s, phase: "ended", heard: "" };
  switch (e.type) {
    case "MIC_READY":
      return s.phase === "connecting" || s.phase === "error" ? { ...s, phase: "listening", heard: "", error: undefined } : s;
    case "MIC_DENIED":
      return { ...s, phase: "error", heard: "", error: e.message };
    case "HEARD":
      return s.phase === "listening" ? { ...s, heard: e.text } : s;
    case "TURN_END":
      return s.phase === "listening" && e.text.trim() ? { ...s, phase: "thinking", heard: e.text.trim() } : s;
    case "REPLY_STARTED":
      return s.phase === "thinking" ? { ...s, phase: "speaking" } : s;
    case "REPLY_DONE":
      return s.phase === "thinking" || s.phase === "speaking" ? { ...s, phase: "listening", heard: "", turns: s.turns + 1 } : s;
    case "INTERRUPT":
      // Barge-in: she cut in (voice or tap) while he was thinking or talking → his voice stops, she has the floor.
      return s.phase === "thinking" || s.phase === "speaking" ? { ...s, phase: "listening", heard: "", turns: s.turns + 1 } : s;
    case "IDLE_TIMEOUT":
      return s.phase === "listening" ? { ...s, phase: "paused", heard: "" } : s;
    case "RESUME":
      return s.phase === "paused" ? { ...s, phase: "listening", heard: "" } : s;
  }
  return s;
}

export function statusText(s: CallState): string {
  switch (s.phase) {
    case "connecting": return "Connecting…";
    case "listening": return "Listening…";
    case "thinking": return "Thinking…";
    case "speaking": return "Wilson is talking";
    case "paused": return "Paused. Tap the orb to talk";
    case "ended": return "Call ended";
    case "error": return s.error || "The microphone isn't available";
  }
}

/* ---------------- end of turn ---------------- */

/** Base pause that ends her turn. 1.4 s sits in the 1.2–1.6 s window: long enough for a breath, short enough to feel live. */
export const END_OF_TURN_MS = 1400;
/** When her words trail off mid-thought ("and…", "so um…", a comma) we wait longer before answering. */
export const MID_THOUGHT_MS = 2300;

const TRAILING = new Set([
  "and", "but", "or", "so", "because", "cause", "um", "uh", "umm", "uhh", "hmm", "like", "the", "a", "an", "to", "of",
  "with", "if", "that", "then", "my", "your", "i", "i'm", "is", "was", "for", "about", "maybe", "well", "also", "just",
  "when", "what", "which", "who", "how", "where", "you", "we", "it's", "are", "in", "on", "at", "kind", "sort",
]);

/** How long to wait after the last recognized word before treating her turn as finished. */
export function endpointDelay(text: string, base = END_OF_TURN_MS, mid = MID_THOUGHT_MS): number {
  const t = text.trim();
  if (!t) return base;
  if (/[,;:—–-]$/.test(t) || /\.\.\.$|…$/.test(t)) return mid;
  const words = t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (TRAILING.has(last)) return mid;
  return base;
}

/* ---------------- barge-in ---------------- */

const wordsOf = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);

/**
 * True when what the mic heard is mostly Wilson's own reply coming back out of the speaker
 * (most of the heard words appear in what he's saying).
 */
export function isLikelyEcho(heard: string, spoken: string): boolean {
  const h = wordsOf(heard);
  if (!h.length) return true;
  const s = new Set(wordsOf(spoken));
  if (!s.size) return false;
  const hits = h.filter((w) => s.has(w)).length;
  return hits / h.length >= 0.6;
}

/** Interrupt him only for real speech: at least two words that aren't his own echo. */
export function shouldBargeIn(heard: string, spoken: string): boolean {
  if (wordsOf(heard).length < 2) return false;
  return !isLikelyEcho(heard, spoken);
}

/* ---------------- call-mode reply style ---------------- */

/** Added to the system context only during a call: shapes replies for speech, not his persona. */
export const SPOKEN_CALL_NOTE =
  "[Live voice call] You're talking out loud with them right now, like a phone call, and everything you write is spoken in your voice. " +
  "Answer the way you'd naturally talk: a conversational turn, usually a few sentences, then let them respond. " +
  "No markdown, bullet points, numbered lists, headings, tables, code blocks, emoji, or URLs — say things in plain spoken sentences. " +
  "If they ask for something long, give the spoken version and offer to go deeper. This only changes how you format replies; you're fully yourself.";
