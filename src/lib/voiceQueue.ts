/**
 * Pure (DOM-free) pieces of Wilson's speech pipeline, kept separate so they can be tested in Node:
 *  - takeChunks: sentence-first chunker for streamed text
 *  - withRetry: retry ONE voice with a short backoff (never a different voice)
 *  - createOrderedSpeaker: synthesizes pieces in parallel (bounded), plays them strictly in order,
 *    never drops a piece; if a piece truly can't be voiced it stops the reply and reports "down".
 */

/* ---------------- chunking ---------------- */
export const FIRST_CHUNK_MAX = 70;  // first words go out fast: the first sentence, or ~70 chars cut at a pause
export const SOFT_CHUNK_MAX = 220;  // soft break for long run-on text without punctuation
export const MERGE_MAX = 260;       // never let an un-terminated tail grow past this while streaming

/**
 * Split text[from..] into speakable chunks. Sentence ends and newlines always break; long run-ons break at a
 * pause (space/comma) after softMax chars. Never cuts inside a word. Returns the new offset; text after it
 * is carried to the next call (or flushed when final).
 */
export function takeChunks(text: string, from: number, final: boolean, isFirst: boolean): { parts: string[]; next: number } {
  const parts: string[] = [];
  let start = from;
  let i = from;
  const softMax = () => (isFirst && parts.length === 0 ? FIRST_CHUNK_MAX : SOFT_CHUNK_MAX);
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      const t = text.slice(start, i + 1).trim();
      if (t) parts.push(t);
      start = i + 1; i = start; continue;
    }
    if (c === "." || c === "!" || c === "?") {
      let j = i + 1;
      while (j < text.length && /[.!?"')\]*]/.test(text[j])) j++;
      if (j < text.length && /\s/.test(text[j])) {
        const t = text.slice(start, j).trim();
        if (t) parts.push(t);
        start = j; i = j; continue;
      }
    }
    if (i - start + 1 >= softMax() && /[\s,;:—–]/.test(c)) {
      const t = text.slice(start, i + 1).trim();
      if (t) parts.push(t);
      start = i + 1;
    }
    i++;
  }
  if (final && start < text.length) {
    const t = text.slice(start).trim();
    if (t) parts.push(t);
    start = text.length;
  }
  // Streaming safety valve: an un-terminated tail longer than MERGE_MAX is cut at its LAST space (never mid-word).
  if (!final && text.length - start > MERGE_MAX) {
    const win = text.slice(start, start + MERGE_MAX);
    const sp = win.lastIndexOf(" ");
    if (sp > 20) { const t = win.slice(0, sp).trim(); if (t) parts.push(t); start = start + sp + 1; }
  }
  return { parts, next: start };
}

/** Split a long sentence at commas/semicolons/dashes into pieces of ~max chars (first piece shorter). Used for on-device Puck. */
export function splitAtPauses(text: string, first: boolean, max = 110, firstMax = 42): string[] {
  const out: string[] = [];
  let rest = text, lim = first ? firstMax : max;
  while (rest.length > lim) {
    const win = rest.slice(0, lim);
    const m = [...win.matchAll(/[,;:—–](\s|$)|\s-\s/g)].filter((x) => (x.index ?? 0) >= 20).pop();
    if (!m) break;
    const cut = (m.index ?? 0) + m[0].length;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim(); lim = max;
  }
  if (rest) out.push(rest);
  return out;
}

/* ---------------- retry ---------------- */
/** An error that retrying the same voice can't fix (daily limit, endpoint missing). */
export class FatalVoiceError extends Error {
  kind: "limit" | "missing" | "other";
  constructor(msg: string, kind: "limit" | "missing" | "other" = "other") { super(msg); this.name = "FatalVoiceError"; this.kind = kind; }
}
export type RetryOpts = {
  attempts: number;              // total tries, including the first
  backoffMs: number[];           // wait before try #2, #3, ... (last value repeats)
  deadlineMs?: number;           // give up starting new tries after this long overall
  stopped?: () => boolean;       // reply was cancelled (tap to interrupt)
  onRetry?: (attempt: number, err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts): Promise<T> {
  const sleep = o.sleep ?? realSleep, now = o.now ?? Date.now;
  const t0 = now();
  let last: unknown = new Error("voice failed");
  for (let a = 0; a < o.attempts; a++) {
    if (o.stopped?.()) throw new Error("stopped");
    if (a > 0) {
      const wait = o.backoffMs[Math.min(a - 1, o.backoffMs.length - 1)] ?? 0;
      if (o.deadlineMs !== undefined && now() - t0 + wait > o.deadlineMs) break;
      o.onRetry?.(a, last);
      await sleep(wait);
      if (o.stopped?.()) throw new Error("stopped");
    }
    try { return await fn(a); } catch (e) { last = e; if (e instanceof FatalVoiceError) throw e; }
  }
  throw last;
}

/** First success of several identical requests (hedging): cuts tail latency and flaky failures without changing voice. */
export function firstSuccess<T>(ps: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let left = ps.length; let lastErr: unknown = null;
    if (!left) return reject(new Error("nothing to wait for"));
    ps.forEach((p) => p.then(resolve, (e) => { lastErr = e; if (--left === 0) reject(lastErr); }));
  });
}

/* ---------------- ordered speaker ---------------- */
export type SpeakerDeps<B> = {
  /** Synthesize one piece with THE locked voice (already retried). Reject = this voice can't do it right now. */
  synth: (text: string, index: number) => Promise<B>;
  /** Play one clip to the end. Resolve false if playback itself failed. */
  play: (clip: B, index: number) => Promise<boolean>;
  /** How many pieces may be synthesizing at once (prefetch while the current one plays). */
  concurrency: number;
  /** Stop prefetching more than this many pieces ahead of the one playing. */
  lookahead?: number;
  stopped: () => boolean;
  onFirstPlay?: () => void;
  onPlay?: (index: number) => void;
  /** A piece couldn't be voiced (after retries) or played (after a replay): the rest of this reply stays text-only. */
  onDown?: (index: number, err: unknown) => void;
  /** Everything queued has been played (or the reply went down / was stopped) and finish() was called. */
  onEnd?: (r: { played: number; total: number; down: boolean }) => void;
};

export function createOrderedSpeaker<B>(d: SpeakerDeps<B>) {
  const texts: string[] = [];
  const results: (Promise<B> | null)[] = [];
  let started = 0, inflight = 0, playIdx = 0, played = 0;
  let playing = false, finished = false, down = false, ended = false;
  const lookahead = d.lookahead ?? 4;

  const pump = () => {
    while (!down && !d.stopped() && inflight < d.concurrency && started < texts.length && started < playIdx + lookahead) {
      const i = started++;
      inflight++;
      const p = d.synth(texts[i], i);
      results[i] = p;
      p.catch(() => {}).finally(() => { inflight--; pump(); });
    }
  };
  const maybeEnd = () => {
    if (ended) return;
    if (d.stopped() || down || (finished && playIdx >= texts.length)) { ended = true; d.onEnd?.({ played, total: texts.length, down }); }
  };
  const loop = async () => {
    if (playing) return; playing = true;
    try {
      while (!down && !d.stopped() && playIdx < texts.length) {
        pump();
        const p = results[playIdx];
        if (!p) { await new Promise((r) => setTimeout(r, 0)); continue; } // not started yet (lookahead) — pump next tick
        let clip: B;
        try { clip = await p; } catch (e) { if (!d.stopped()) { down = true; d.onDown?.(playIdx, e); } break; }
        if (d.stopped()) break;
        if (played === 0) d.onFirstPlay?.();
        d.onPlay?.(playIdx);
        let ok = await d.play(clip, playIdx);
        if (!ok && !d.stopped()) ok = await d.play(clip, playIdx); // one replay of the SAME clip before giving up
        if (d.stopped()) break;
        if (!ok) { down = true; d.onDown?.(playIdx, new Error("playback failed")); break; }
        played++;
        results[playIdx] = null; // free memory
        playIdx++;
      }
    } finally { playing = false; }
    maybeEnd();
  };
  return {
    push(text: string) {
      if (finished || down || d.stopped() || !text) return;
      texts.push(text); pump(); void loop();
    },
    finish() { finished = true; if (!playing) maybeEnd(); void loop(); },
    /** Pieces queued but not yet played (incl. the one playing). */
    backlog() { return texts.length - playIdx; },
    get played() { return played; },
    get queued() { return texts.length; },
    get isDown() { return down; },
  };
}
