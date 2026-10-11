/**
 * Wilson's voice: Echo (Kokoro am_echo) rendered on the server via the Wilson worker /tts.
 * Echo ONLY. No device/speechSynthesis voice and no in-browser model: if Echo isn't ready,
 * Wilson stays silent and shows "waking up" while retrying through Render's cold start.
 * Playback goes through ONE AudioContext unlocked on the first user gesture (required on iOS).
 */
import { attachNode, getAudioContext, setSpeakingFlag } from "./audioBus";

const SPEED = 1.1;
const SERVER_TTS_URL = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev") + "/tts";
let serverDown = false;

let currentSource: AudioBufferSourceNode | null = null;
let detachCurrent: (() => void) | null = null;
let generation = 0;
let unlocked = false;

export type SpeakResult = "success" | "skipped" | "error";
export type VoiceStatus = { state: "idle" | "waking" | "ready"; progress: number; reason?: string };
let status: VoiceStatus = { state: "idle", progress: 0 };
const statusListeners = new Set<(s: VoiceStatus) => void>();
function setStatus(s: Partial<VoiceStatus>) { status = { ...status, ...s }; statusListeners.forEach((l) => l(status)); }
export function getVoiceStatus() { return status; }
export function subscribeVoiceStatus(l: (s: VoiceStatus) => void) { statusListeners.add(l); return () => { statusListeners.delete(l); }; }

/** Call synchronously inside a user gesture (tap send / mic / orb / Play). Unlocks iOS audio. */
export function primePlayback(): void {
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    if (!unlocked) {
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination); src.start(0);
      } catch { /* ignore */ }
    }
  }
  unlocked = true;
}

export function stopSpeaking(): void {
  generation++;
  try { currentSource?.stop(); } catch { /* ignore */ }
  currentSource = null;
  detachCurrent?.(); detachCurrent = null;
  setSpeakingFlag(false);
  setPending(false);
  const e = endCurrent; endCurrent = null; e?.();
}

/** Strip markdown, emoji, tags so only clean words are spoken. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_#>~|<>{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/* ---------------- streaming Echo (sentence-by-sentence) ---------------- */
const MAX_PARALLEL = 1; // free Render CPU serializes anyway; queuing there risks proxy timeouts
const MERGE_MAX = 80; // each clip must finish < ~100 s (Render edge timeout) on the free CPU
const WAKE_BUDGET_MS = 120000; // Render free cold start + slow first clip
let pending = false;
const pendingListeners = new Set<(p: boolean) => void>();
function setPending(p: boolean) { if (p !== pending) { pending = p; pendingListeners.forEach((l) => l(p)); } }
/** True while Echo audio has been requested but nothing is playing yet ("getting ready to speak"). */
export function subscribeVoicePending(l: (p: boolean) => void) { pendingListeners.add(l); return () => { pendingListeners.delete(l); }; }

let lastWarm = 0;
/** Tiny ping so Render's free instance wakes before a reply needs it. Throttled to once per 60s. */
export function warmVoice(): void {
  if (serverDown || Date.now() - lastWarm < 60000) return;
  lastWarm = Date.now();
  void fetch(SERVER_TTS_URL + "/health", { method: "GET", cache: "no-store" }).catch(() => {});
}

async function fetchOnce(text: string, speed: number, timeoutMs: number): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), Math.max(5000, timeoutMs));
  try {
    const res = await fetch(SERVER_TTS_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speed }), signal: ctrl.signal,
    });
    if (res.status === 503) { serverDown = true; throw new Error("voice server not configured (503)"); }
    if (!res.ok) throw new Error("tts http " + res.status);
    return await res.arrayBuffer();
  } finally { clearTimeout(to); }
}

/** Fetch one Echo clip, retrying through Render's cold start until `deadline`. */
async function fetchClip(text: string, speed: number, my: number, deadline: number): Promise<AudioBuffer | null> {
  let lastErr: unknown = null;
  while (my === generation && !serverDown) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      const data = await fetchOnce(text, speed, left);
      if (my !== generation) return null;
      const ctx = getAudioContext();
      if (!ctx) throw new Error("no AudioContext");
      return await ctx.decodeAudioData(data);
    } catch (e) {
      lastErr = e;
      if (serverDown || my !== generation) break;
      console.warn("[voice] Echo not ready, retrying:", (e as Error).message);
      setStatus({ state: "waking" });
      lastWarm = 0; warmVoice();
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw lastErr ?? new Error("Echo timed out");
}

/** Split off complete sentences from `text`, starting at `from`. Returns sentences + new offset. */
function takeSentences(text: string, from: number, final: boolean): { parts: string[]; next: number } {
  const parts: string[] = [];
  let start = from, next = from;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    let end = -1;
    if (c === "\n") end = i + 1;
    else if (c === "." || c === "!" || c === "?") {
      let j = i + 1;
      while (j < text.length && /[.!?"')\]*]/.test(text[j])) j++;
      if (j < text.length && /\s/.test(text[j])) end = j;
      i = j - 1;
    }
    if (end > 0) { const t = text.slice(start, end).trim(); if (t) parts.push(t); start = next = end; }
  }
  if (final && next < text.length) { const t = text.slice(next).trim(); if (t) parts.push(t); next = text.length; }
  return { parts, next };
}

export type SpeechStream = { push: (textSoFar: string) => void; finish: (finalText: string) => void };

/**
 * Start speaking a reply while it is still streaming. Call push() with the full displayed text so far,
 * then finish() with the final text. Echo only: if Echo never answers, Wilson stays silent (no device voice).
 */
export type StreamHooks = { onStart?: () => void; onEnd?: () => void };
let endCurrent: (() => void) | null = null;

export function startSpeechStream(speed: number = SPEED, hooks: StreamHooks = {}): SpeechStream {
  stopSpeaking();
  const my = generation;
  let ended = false;
  const end = () => { if (!ended) { ended = true; if (endCurrent === end) endCurrent = null; hooks.onEnd?.(); } };
  endCurrent = end;
  let offset = 0, buffer = "", sentFirst = false, done = false, failed = false, played = false;
  let inflight = 0;
  const wakeDeadline = Date.now() + WAKE_BUDGET_MS - 90000; // first clip gets the full budget
  const queue: Promise<AudioBuffer | null>[] = [];
  const spoken: string[] = [];
  let playing = false, playIdx = 0;
  let fullText = "";
  const waiters: (() => void)[] = [];
  const slot = () => inflight < MAX_PARALLEL ? Promise.resolve() : new Promise<void>((r) => waiters.push(r));

  const playLoop = async () => {
    if (playing) return; playing = true;
    while (playIdx < queue.length && my === generation) {
      let buf: AudioBuffer | null = null;
      if (!played) setPending(true);
      try { buf = await queue[playIdx]; } catch (e) { console.warn("[voice] Echo clip failed:", (e as Error).message); failed = true; }
      if (my !== generation) break;
      if (!buf) { if (failed) break; playIdx++; continue; }
      const ctx = getAudioContext()!;
      if (ctx.state !== "running") { try { await ctx.resume(); } catch { /* ignore */ } }
      setPending(false);
      if (!played) hooks.onStart?.();
      played = true;
      if (status.state !== "ready") setStatus({ state: "ready" });
      await new Promise<void>((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = buf; currentSource = src; detachCurrent = attachNode(src);
        src.onended = () => { if (currentSource === src) { detachCurrent?.(); detachCurrent = null; currentSource = null; } resolve(); };
        src.start();
      });
      playIdx++;
    }
    playing = false;
    if (my !== generation) return;
    if (failed && done) { setPending(false); if (!played) setStatus({ state: "waking" }); end(); return; }
    if (done && playIdx >= queue.length) { setPending(false); end(); }
  };

  const dispatch = (text: string) => {
    const t = toSpeakable(text);
    if (!t || failed || serverDown) return;
    spoken.push(t);
    queue.push((async () => {
      await slot(); inflight++;
      try { return await fetchClip(t, speed, my, Math.max(Date.now(), wakeDeadline) + 90000); }
      finally { inflight--; waiters.shift()?.(); }
    })());
    void playLoop();
  };

  const flush = (force: boolean) => {
    if (buffer && (force || inflight === 0)) { dispatch(buffer); buffer = ""; }
  };

  const feed = (text: string, final: boolean) => {
    if (my !== generation) return;
    const { parts, next } = takeSentences(text, offset, final);
    offset = next;
    for (const p of parts) {
      if (!sentFirst) { sentFirst = true; dispatch(p); continue; }
      if (buffer && buffer.length + 1 + p.length > MERGE_MAX) { dispatch(buffer); buffer = p; }
      else buffer = buffer ? buffer + " " + p : p;
    }
    flush(final);
  };

  if (serverDown) {
    return { push: () => {}, finish: () => { setStatus({ state: "waking" }); end(); } };
  }
  setPending(true);
  return {
    push: (t) => { fullText = t; feed(t, false); },
    finish: (t) => {
      if (my !== generation || done) return;
      // final text may differ from streamed text (tags stripped); keep offset if prefix still matches
      if (!t.startsWith(fullText.slice(0, offset))) offset = Math.min(offset, t.length);
      fullText = t; done = true; feed(t, true);
      if (!queue.length) { setPending(false); end(); }
      else void playLoop();
    },
  };
}

/** Speak one finished message with Echo (sentence-chunked). Works regardless of the auto-voice setting. */
export function speakMessage(text: string, speed: number = SPEED, hooks: StreamHooks = {}): void {
  primePlayback();
  startSpeechStream(speed, hooks).finish(text);
}

/** Speak a full text with Echo. Resolves when playback ends (or Echo gave up: silent). */
export function speak(text: string, speed: number = SPEED): Promise<SpeakResult> {
  return new Promise((resolve) => {
    let started = false;
    startSpeechStream(speed, { onStart: () => { started = true; }, onEnd: () => resolve(started ? "success" : "skipped") }).finish(text);
  });
}
