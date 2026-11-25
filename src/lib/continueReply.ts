/**
 * Detect truncated chat replies and decide whether to ask the model to continue.
 * Jenny's cut-off answers often arrived with no finish_reason (the worker stream
 * died mid-sentence, e.g. Gemini UNAVAILABLE) so we cannot rely on length alone.
 */

/** Safety cap sent as max_tokens. High enough that thinking cannot eat a full answer; the app also continues. */
export const REPLY_MAX_TOKENS = 16384;

/** How many automatic continue passes after the first stream. */
export const MAX_CONTINUES = 3;

/** True when the visible text looks like it stopped mid-sentence / mid-clause. */
export function looksMidSentence(text: string): boolean {
  const t = text.replace(/\s+$/g, "").replace(/\*+$/g, "").trim();
  if (t.length < 40) return false;
  if (/[.!?]["')\]]*$/.test(t)) return false;
  return true;
}

/**
 * Continue when the model hit a token cap, or the stream died without a clean
 * finish and the text does not end on a sentence. Do not continue aborted or
 * safety-stopped replies.
 */
export function shouldContinue(finishReason: string | undefined, text: string): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;
  if (finishReason === "aborted" || finishReason === "content_filter" || finishReason === "SAFETY") return false;
  if (finishReason === "length") return true;
  return looksMidSentence(raw);
}
