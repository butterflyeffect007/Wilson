/**
 * Detect truncated chat replies, decide whether to auto-continue, and strip
 * overlap when the model repeats words it already wrote (a common continue habit).
 */

/** Safety cap sent as max_tokens. High enough that thinking cannot eat a full answer; the app also continues. */
export const REPLY_MAX_TOKENS = 16384;

/** How many automatic continue passes after the first stream. */
export const MAX_CONTINUES = 3;

/** Wait this long for a continue stream before first attaching it, so overlap can be trimmed. */
export const CONTINUE_HOLD_CHARS = 100;

const WEAK_END = /[,;:—–-]\s*$/;
const FUNCTION_TAIL = /\b(the|a|an|and|or|but|if|to|for|of|in|on|at|with|by|as|from|that|this|these|those|we|they|i|he|she|it|need|needs|each|when|while|because|which|who|than|then|so|its|it's|into|onto|over|under|about|after|before|between|without)\s*$/i;
const PREAMBLE = /^(?:(?:sure|okay|ok|right|got it|of course|yes)[,.]?\s+)*(?:(?:i(?:'ll| will)?\s+)?continu(?:e|ing)(?:\s+on|\s+exactly)?(?:\s+where I left off)?|picking up(?:\s+where I left off)?|as I was saying|to (?:finish|continue))[:.\s—–-]*/i;

function lastSegment(t: string): string {
  const parts = t.split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1] || t;
}

/** True when the visible text looks like it stopped mid-sentence / mid-clause. */
export function looksMidSentence(text: string): boolean {
  const t = text.replace(/\s+$/g, "").replace(/\*+$/g, "").trim();
  if (t.length < 40) return false;
  if (/[.!?]["')\]]*$/.test(t)) return false;
  if (WEAK_END.test(t) || FUNCTION_TAIL.test(t)) return true;
  const last = lastSegment(t);
  // A leftover clause ("Instead, they apply") or a dangling word ("for each historical").
  return last.length >= 12 && /[A-Za-z0-9]$/.test(last);
}

function strongMidClause(text: string): boolean {
  const t = text.replace(/\s+$/g, "").replace(/\*+$/g, "").trim();
  return WEAK_END.test(t) || FUNCTION_TAIL.test(t);
}

/** A finished sentence followed by a leftover clause, e.g. "...value. Instead, they apply" */
function danglingAfterComplete(text: string): boolean {
  const t = text.replace(/\s+$/g, "").replace(/\*+$/g, "").trim();
  if (/[.!?]["')\]]*$/.test(t)) return false;
  const last = lastSegment(t);
  return last !== t && last.length >= 8 && /[A-Za-z0-9]$/.test(last);
}

/**
 * Continue when the model hit a token cap, or the stream died mid-sentence.
 * A clean finish_reason=stop is not enough — many complete answers omit a
 * final period, and continuing those makes him repeat himself.
 */
export function shouldContinue(finishReason: string | undefined, text: string): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;
  if (finishReason === "aborted" || finishReason === "content_filter" || finishReason === "SAFETY") return false;
  if (finishReason === "length") return true;
  if (finishReason === "stop") return strongMidClause(raw) || danglingAfterComplete(raw);
  return looksMidSentence(raw);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * If `incoming` starts by repeating a suffix of `previous` (or a short
 * "Continuing:" preamble), return the new tail only. Pure and safe for
 * both the text bubble and the speech queue.
 */
export function trimContinuationOverlap(previous: string, incoming: string): string {
  let next = (incoming || "").replace(/^\s+/, "");
  if (!next) return "";
  next = next.replace(PREAMBLE, "").replace(/^\s+/, "");
  if (!next) return "";
  const prev = (previous || "").trimEnd();
  if (!prev) return next;

  const max = Math.min(prev.length, next.length, 1200);
  let cut = 0;
  for (let n = max; n >= 12; n--) {
    if (next.startsWith(prev.slice(-n))) { cut = n; break; }
  }
  if (!cut) {
    const words = prev.split(/\s+/).filter(Boolean);
    const top = Math.min(words.length, 40);
    for (let w = top; w >= 4; w--) {
      const suf = words.slice(-w).join(" ");
      if (next.startsWith(suf)) { cut = suf.length; break; }
      const re = new RegExp("^" + escapeRe(suf).replace(/\\s+/g, "\\s+"), "i");
      const m = next.match(re);
      if (m) { cut = m[0].length; break; }
    }
  }
  if (cut) next = next.slice(cut).replace(/^\s+/, "");
  return next;
}

/** After trimming, true when the continue pass added nothing useful (don't keep looping). */
export function continueAddedNothing(incoming: string, trimmed: string): boolean {
  const inc = (incoming || "").trim();
  const out = (trimmed || "").trim();
  if (!inc) return true;
  if (!out) return true;
  if (out.length < 24 && inc.length >= 80) return true;
  return false;
}
