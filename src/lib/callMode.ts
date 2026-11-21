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
  /** She's been quiet a long while: show a gentle "still here" note (the call stays open and listening). */
  nudge?: boolean;
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
  | { type: "CONTINUE"; text: string }
  | { type: "NUDGE" }
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
      return s.phase === "listening" ? { ...s, heard: e.text, nudge: false } : s;
    case "NUDGE":
      return s.phase === "listening" && !s.heard ? { ...s, nudge: true } : s;
    case "CONTINUE":
      // She wasn't done: she picked her thought back up while he was still thinking (before his voice started).
      // His half-made reply is dropped and her turn carries on from what she'd already said.
      return s.phase === "thinking" ? { ...s, phase: "listening", heard: e.text, nudge: false } : s;
    case "TURN_END":
      return s.phase === "listening" && e.text.trim() ? { ...s, phase: "thinking", heard: e.text.trim(), nudge: false } : s;
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
    case "listening": return s.nudge && !s.heard ? "Still here. Take your time" : "Listening…";
    case "thinking": return "Thinking…";
    case "speaking": return "Wilson is talking";
    case "paused": return "Paused. Tap the orb to talk";
    case "ended": return "Call ended";
    case "error": return s.error || "The microphone isn't available";
  }
}

/* ---------------- end of turn ---------------- */

/**
 * Base pause that ends her turn. People pause mid-thought for a breath, to find a word, or for rhythm, so this
 * is deliberately unhurried (2.2 s); a faster turn is always one tap on the orb away.
 */
export const END_OF_TURN_MS = 2200;
/** When her words trail off mid-thought ("and…", "so um…", "like", a comma) we wait much longer. */
export const MID_THOUGHT_MS = 3800;
/** Each time she picks a thought back up after he almost answered, wait this much longer for the rest of the call. */
export const PATIENCE_STEP_MS = 500;
export const PATIENCE_MAX_MS = 1500;

const TRAILING = new Set([
  "and", "but", "or", "so", "because", "cause", "cuz", "um", "uh", "umm", "uhh", "uhm", "erm", "er", "ah", "mm", "hm", "hmm",
  "like", "the", "a", "an", "to", "of", "with", "if", "that", "then", "my", "your", "i", "i'm", "is", "was", "for", "about",
  "maybe", "well", "also", "just", "when", "what", "which", "who", "how", "where", "you", "we", "it's", "are", "in", "on", "at",
  "kind", "sort", "basically", "literally", "actually", "honestly", "not", "from", "into", "by", "as", "than", "since", "until",
  "while", "though", "although", "he", "she", "they", "this", "these", "those", "his", "her", "their", "our", "very", "really",
  "gonna", "wanna", "gotta", "need", "want", "think", "mean", "be", "been", "were", "do", "did", "have", "had", "can", "could",
  "would", "should", "will", "like,", "plus", "even", "still", "some", "every", "any", "no",
]);
/** Two-word trail-offs ("you know", "I mean", "and then") — she's usually still going. */
const TRAILING_PAIRS = new Set(["you know", "i mean", "and then", "so then", "or like", "and like", "kind of", "sort of", "i think", "i guess", "i feel"]);

/** How long to wait after the last recognized word before treating her turn as finished. `extra` = learned patience. */
export function endpointDelay(text: string, base = END_OF_TURN_MS, mid = MID_THOUGHT_MS, extra = 0): number {
  const t = text.trim();
  if (!t) return base + extra;
  if (/[,;:—–-]$/.test(t) || /\.\.\.$|…$/.test(t)) return mid + extra;
  const words = t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (TRAILING.has(last)) return mid + extra;
  if (words.length >= 2 && TRAILING_PAIRS.has(words.slice(-2).join(" "))) return mid + extra;
  return base + extra;
}

/** True when the mic picked up real words (not an empty result or a stray one-letter blip). */
export function hasRealSpeech(text: string): boolean {
  return text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).some((w) => w.length > 1);
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
