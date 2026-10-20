/**
 * Wilson's voice.
 * 1) Primary: Kokoro "Puck" (am_puck) synthesized on the device in a Web Worker (puckVoice.ts), loaded lazily
 *    after the first tap / an idle moment and cached by the browser, so it downloads once.
 * 2) Fallback: Deepgram Aura-2 (arcas) via Cloudflare Workers AI through the Wilson worker /tts (MP3), with the
 *    IndexedDB clip cache — used while Puck is still downloading, on devices too weak for it, or if it fails.
 * 3) If both fail (e.g. the daily free Aura limit), Wilson stays text-only (no robotic device voice).
 * Playback: ONE reused HTMLAudioElement (playsinline), unlocked by playing a silent clip inside the first tap.
 * HTMLAudioElement is not muted by the iPhone ringer switch the way Web Audio is, and avoids
 * AudioContext "suspended"/"interrupted" states in home-screen PWAs. Web Audio is only used for
 * the orb's analyser on non-iOS browsers (audioBus.attachAudio bypasses it on iOS/Safari).
 */
import { attachAudio, detachAudio, setSpeakingFlag } from "./audioBus";
import { puckStats, ensurePuck, getPuckFail, getPuckProgress, getPuckState, puckBlockedReason, puckCancel, puckSupported, puckSynth, subscribePuck, waitForPuck } from "./puckVoice";

/** Load Puck in an idle moment (never blocks the app or the tap that triggered it). */
function schedulePuck() {
  if (getPuckState() !== "off") return;
  const ric = (globalThis as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
  if (ric) ric(() => ensurePuck(), { timeout: 3000 }); else setTimeout(() => ensurePuck(), 1500);
}

const SPEED = 1.1;
const SERVER_TTS_URL = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev") + "/tts";
const SILENT_MP3 = "data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/84TAAAAAAAAAAAAASW5mbwAAAA8AAAAFAAACoABtbW1tbW1tbW1tbW1tbW1tbW1tkpKSkpKSkpKSkpKSkpKSkpKSkpK2tra2tra2tra2tra2tra2tra2ttvb29vb29vb29vb29vb29vb29vb//////////////////////////8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJARQAAAAAAAAAqC9P8vrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80TEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEUwAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEpgAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";
let serverDown = false;

let generation = 0;
let unlocked = false;
let el: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let finishCurrentClip: (() => void) | null = null;

/* ---- tiny on-device debug log (shown in Settings → Voice test) ---- */
export type VoiceDebug = { lastEvent: string; lastError: string };
let debug: VoiceDebug = { lastEvent: "", lastError: "" };
const debugListeners = new Set<(d: VoiceDebug) => void>();
function dbg(ev: string, err?: unknown) {
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  debug = { lastEvent: `${t} ${ev}`, lastError: err !== undefined ? `${t} ${errText(err)}` : debug.lastError };
  if (err !== undefined) console.warn("[voice]", ev, err); else console.info("[voice]", ev);
  debugListeners.forEach((l) => l(debug));
}
function errText(e: unknown) { const x = e as { name?: string; message?: string }; return `${x?.name ?? "Error"}: ${x?.message ?? String(e)}`.slice(0, 160); }
export function getVoiceDebug() { return debug; }
export function subscribeVoiceDebug(l: (d: VoiceDebug) => void) { debugListeners.add(l); return () => { debugListeners.delete(l); }; }

function audioEl(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.setAttribute("playsinline", ""); el.setAttribute("webkit-playsinline", "");
    (el as any).playsInline = true;
    el.preload = "auto";
  }
  return el;
}

export type SpeakResult = "success" | "skipped" | "error";
/** "unavailable": a reply couldn't be voiced (Puck not on this phone + Aura resting/offline); shown as a small note. */
export type VoiceStatus = { state: "idle" | "ready" | "resting" | "preparing" | "unavailable"; progress: number; reason?: string };
let status: VoiceStatus = { state: "idle", progress: 0 };
const statusListeners = new Set<(s: VoiceStatus) => void>();
function setStatus(s: Partial<VoiceStatus>) { status = { ...status, ...s }; statusListeners.forEach((l) => l(status)); }
export function getVoiceStatus() { return status; }
export function subscribeVoiceStatus(l: (s: VoiceStatus) => void) { statusListeners.add(l); return () => { statusListeners.delete(l); }; }

/**
 * Call SYNCHRONOUSLY inside a user gesture (tap send / mic / orb / Play). Plays a silent clip on the shared
 * audio element so iOS lets that element play later (after async fetches) without another tap.
 */
export function primePlayback(): void {
  schedulePuck();
  if (unlocked) return;
  const a = audioEl();
  try {
    a.muted = false;
    a.src = SILENT_MP3;
    const p = a.play();
    unlocked = true;
    if (p && typeof p.then === "function") p.then(() => dbg("audio unlocked"), (e) => { unlocked = false; dbg("unlock failed", e); });
  } catch (e) { dbg("unlock threw", e); }
}

/* "Wilson is in the middle of a spoken reply" (from the first request until the last sentence ends, gaps included). */
let active = false;
const activeListeners = new Set<(a: boolean) => void>();
function setActive(a: boolean) { if (a !== active) { active = a; activeListeners.forEach((l) => l(a)); } }
export function isVoiceActive() { return active; }
export function subscribeVoiceActive(l: (a: boolean) => void) { activeListeners.add(l); return () => { activeListeners.delete(l); }; }

export function stopSpeaking(): void {
  generation++;
  puckCancel(generation);
  if (el && currentUrl) { try { el.pause(); } catch { /* ignore */ } }
  finishCurrentClip?.(); finishCurrentClip = null;
  if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
  if (el) detachAudio(el);
  setSpeakingFlag(false);
  setPending(false);
  setActive(false);
  const e = endCurrent; endCurrent = null; e?.();
}

/** Play one MP3 blob on the shared element; resolves when it ends (or errors / is stopped). */
function playBlob(blob: Blob, my: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (my !== generation) return resolve();
    const a = audioEl();
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(blob);
    let settled = false;
    let stall: ReturnType<typeof setTimeout> | null = null;
    let resumed = 0;
    const cleanup = () => {
      a.removeEventListener("ended", done); a.removeEventListener("error", onErr);
      a.removeEventListener("pause", onPause); a.removeEventListener("loadedmetadata", armStall);
      if (stall) clearTimeout(stall);
    };
    const done = () => {
      if (settled) return; settled = true;
      cleanup();
      if (finishCurrentClip === done) finishCurrentClip = null;
      resolve();
    };
    const onErr = () => { dbg("audio element error", a.error ? { name: "MediaError", message: `code ${a.error.code} ${a.error.message ?? ""}` } : "unknown"); done(); };
    // iOS can pause the element on its own (notification sound, Siri, audio-session hiccup) and then never fire
    // "ended", which used to leave the rest of the reply stuck. Resume it, and never wait forever on one clip.
    const onPause = () => {
      if (settled || my !== generation || a.ended) return;
      if (resumed++ < 2) setTimeout(() => { if (!settled && my === generation && a.paused && !a.ended) a.play().catch(() => done()); }, 250);
      else done();
    };
    const armStall = () => {
      if (stall) clearTimeout(stall);
      const secs = isFinite(a.duration) && a.duration > 0 ? a.duration : 60;
      stall = setTimeout(() => { dbg("clip never ended, moving on"); done(); }, secs * 1000 + 5000);
    };
    finishCurrentClip = done;
    a.addEventListener("ended", done); a.addEventListener("error", onErr);
    a.addEventListener("pause", onPause); a.addEventListener("loadedmetadata", armStall);
    a.src = currentUrl;
    attachAudio(a);
    armStall();
    const tryPlay = (retry: boolean) => {
      const p = a.play();
      if (p && typeof p.then === "function") p.then(() => dbg(`playing ${(blob.size / 1024).toFixed(0)} KB`), (e) => {
        dbg("play() rejected", e);
        if (retry && !settled && my === generation) setTimeout(() => tryPlay(false), 300); else done();
      });
    };
    tryPlay(true);
  });
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

/* ---------------- streaming voice (continuous chunking) ---------------- */
const MAX_PARALLEL = 2;
const MERGE_MAX = 180;          // tighter for conversational cadence (was 250)
const FIRST_CHUNK_MAX = 55;     // fire the first words fast
const SOFT_CHUNK_MAX = 95;      // soft target once speaking has started
const CLIP_TIMEOUT_MS = 20000;
/** How long a reply waits for Puck to finish downloading (~92 MB) when the server voice can't help. */
const PUCK_WAIT_MS = 240000;
let pending = false;
const pendingListeners = new Set<(p: boolean) => void>();
function setPending(p: boolean) { if (p !== pending) { pending = p; pendingListeners.forEach((l) => l(p)); } }
/** True while voice audio has been requested but nothing is playing yet ("getting ready to speak"). */
export function subscribeVoicePending(l: (p: boolean) => void) { pendingListeners.add(l); return () => { pendingListeners.delete(l); }; }

/** Typing / opening: start getting Puck ready in the background (Workers AI itself needs no warm-up). */
export function warmVoice(): void { schedulePuck(); }

// Once Puck is ready, the Aura daily limit no longer silences Wilson.
subscribePuck(() => {
  const p = getPuckState();
  if (p === "ready" && (status.state === "resting" || status.state === "preparing" || status.state === "unavailable")) setStatus({ state: "ready", reason: undefined });
  else if (p === "loading" && status.state === "preparing") setStatus({ progress: getPuckProgress() });
  else if (p === "failed" && status.state === "preparing") setStatus(noVoiceStatus());
});

/** What to show when a reply can't be voiced right now. */
function noVoiceStatus(): Partial<VoiceStatus> {
  const f = getPuckFail();
  // Plain reason when we know one; otherwise the real error text (never "couldn't start: couldn't start").
  const detail = f ? (/couldn't start$/.test(f.plain) ? `error: ${f.error.slice(0, 90)}` : f.plain.replace(/\s*\([^)]*\)\s*$/, "")) : "";
  const why = puckBlockedReason() || (getPuckState() === "failed" ? `Puck couldn't start${detail ? `: ${detail}` : ""}; see Settings → Voice test` : "");
  if (isVoiceResting()) return { state: why ? "unavailable" : "resting", reason: why || undefined };
  return { state: "unavailable", reason: why || "the voice server didn't answer" };
}

/* ---- client-side clip cache (IndexedDB) so replays don't spend the daily voice allowance ---- */
const IDB_NAME = "wilson-voice", IDB_STORE = "clips";
let idbP: Promise<IDBDatabase | null> | null = null;
function idb(): Promise<IDBDatabase | null> {
  if (!idbP) idbP = new Promise((res) => {
    try {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return idbP;
}
async function clipKey(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("apollo|" + text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function cacheGet(key: string): Promise<Blob | null> {
  const db = await idb(); if (!db) return null;
  return new Promise((res) => {
    try {
      const q = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      q.onsuccess = () => res(q.result ? new Blob([q.result as ArrayBuffer], { type: "audio/mpeg" }) : null);
      q.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function cachePut(key: string, blob: Blob) {
  const db = await idb(); if (!db) return;
  try { const buf = await blob.arrayBuffer(); db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(buf, key); } catch { /* quota */ }
}

/** Daily free voice limit hit (worker 429): stay quiet until the reset. */
const REST_KEY = "wilson-aura-resting-until";
let restingUntil = (() => { try { return Number(localStorage.getItem(REST_KEY)) || 0; } catch { return 0; } })();
function nextResetUtcMidnight() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
function markResting() { restingUntil = nextResetUtcMidnight(); try { localStorage.setItem(REST_KEY, String(restingUntil)); } catch { /* ignore */ } }
export function isVoiceResting() { return Date.now() < restingUntil; }
class VoiceLimitError extends Error { constructor() { super("daily voice limit reached"); this.name = "VoiceLimit"; } }

async function fetchOnce(text: string, speed: number, timeoutMs: number): Promise<Blob> {
  const key = await clipKey(text).catch(() => "");
  if (key) { const hit = await cacheGet(key); if (hit) { dbg("clip from device cache"); return hit; } }
  if (isVoiceResting()) throw new VoiceLimitError();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), Math.max(5000, timeoutMs));
  try {
    const res = await fetch(SERVER_TTS_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speed }), signal: ctrl.signal,
    });
    if (res.status === 503) { serverDown = true; throw new Error("voice server not configured (503)"); }
    if (res.status === 429) { markResting(); throw new VoiceLimitError(); }
    if (!res.ok) throw new Error("tts http " + res.status);
    const blob = await res.blob();
    if (blob.size < 100) throw new Error("tts empty audio");
    const out = blob.type ? blob : new Blob([blob], { type: "audio/mpeg" });
    if (key) void cachePut(key, out);
    return out;
  } finally { clearTimeout(to); }
}

/** Fetch one clip (MP3 blob). One quick retry on a transient error. */
async function fetchClip(text: string, speed: number, my: number): Promise<Blob | null> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2 && my === generation && !serverDown; attempt++) {
    try {
      const t0 = Date.now();
      const blob = await fetchOnce(text, speed, CLIP_TIMEOUT_MS);
      dbg(`tts 200 ${blob.type || "?"} ${(blob.size / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return my === generation ? blob : null;
    } catch (e) {
      lastErr = e;
      dbg("tts request failed", e);
      if ((e as Error).name === "AbortError" || (e as Error).name === "VoiceLimit") break;
    }
  }
  throw lastErr ?? new Error("voice failed");
}

/**
 * Continuous chunker.
 * - Emits as soon as we have enough tokens (or a natural break).
 * - No longer requires a terminal . ! ? before the first (and subsequent) clips can start.
 * - Still prefers sentence boundaries when they appear, but never blocks on them.
 */
function takeChunks(text: string, from: number, final: boolean, isFirst: boolean): { parts: string[]; next: number } {
  const parts: string[] = [];
  let start = from;
  let i = from;
  const softMax = isFirst ? FIRST_CHUNK_MAX : SOFT_CHUNK_MAX;

  while (i < text.length) {
    const c = text[i];

    // Hard break on newline
    if (c === "\n") {
      const t = text.slice(start, i + 1).trim();
      if (t) parts.push(t);
      start = i + 1;
      i = start;
      continue;
    }

    // Prefer real sentence ends when present
    if (c === "." || c === "!" || c === "?") {
      let j = i + 1;
      while (j < text.length && /[.!?"')\]*]/.test(text[j])) j++;
      if (j < text.length && /\s/.test(text[j])) {
        const t = text.slice(start, j).trim();
        if (t) parts.push(t);
        start = j;
        i = j;
        continue;
      }
    }

    // Soft break: enough characters and a natural pause point (space, comma, etc.)
    const len = i - start + 1;
    if (len >= softMax && /[\s,;:—–]/.test(c)) {
      const t = text.slice(start, i + 1).trim();
      if (t) parts.push(t);
      start = i + 1;
    }

    i++;
  }

  // On final, flush whatever remains
  if (final && start < text.length) {
    const t = text.slice(start).trim();
    if (t) parts.push(t);
    start = text.length;
  }

  // Safety: never let a single piece grow past MERGE_MAX even without a break
  if (!final && start < text.length && (text.length - start) > MERGE_MAX) {
    const cut = start + MERGE_MAX;
    const t = text.slice(start, cut).trim();
    if (t) parts.push(t);
    start = cut;
  }

  return { parts, next: start };
}

/** Split a long sentence at commas/semicolons/dashes into pieces of ~PUCK_MAX chars (first piece shorter). */
const PUCK_MAX = 110, PUCK_FIRST = 42; // shorter first piece so the first words start sooner
function splitForPuck(text: string, first: boolean): string[] {
  const out: string[] = [];
  let rest = text, max = first ? PUCK_FIRST : PUCK_MAX;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    const m = [...win.matchAll(/[,;:—–](\s|$)|\s-\s/g)].filter((x) => (x.index ?? 0) >= 20).pop();
    if (!m) break;
    const cut = (m.index ?? 0) + m[0].length;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim(); max = PUCK_MAX;
  }
  if (rest) out.push(rest);
  return out;
}

export type SpeechStream = { push: (textSoFar: string) => void; finish: (finalText: string) => void };

/**
 * Start speaking a reply while it is still streaming. Call push() with the full displayed text so far,
 * then finish() with the final text. server voice only: if it never answers, Wilson stays silent (no device voice).
 */
export type StreamHooks = { onStart?: () => void; onEnd?: () => void };
let endCurrent: (() => void) | null = null;

export function startSpeechStream(speed: number = SPEED, hooks: StreamHooks = {}): SpeechStream {
  stopSpeaking();
  const my = generation;
  let ended = false;
  const end = () => { if (!ended) { ended = true; if (endCurrent === end) { endCurrent = null; setActive(false); } hooks.onEnd?.(); } };
  endCurrent = end;
  let offset = 0, buffer = "", sentFirst = false, done = false, played = false;
  let inflight = 0;
  const queue: Promise<Promise<Blob | null>[]>[] = [];
  const spoken: string[] = [];
  let playing = false, playIdx = 0;
  let fullText = "";
  const waiters: (() => void)[] = [];
  const slot = () => inflight < MAX_PARALLEL ? Promise.resolve() : new Promise<void>((r) => waiters.push(r));
  /*
   * Which voice speaks each piece:
   *  1. Puck whenever it's loaded on this device, even if the phone is slow (Aura has a daily cap, Puck doesn't).
   *  2. Aura-2 arcas while Puck is still downloading / can't run here, unless Aura is resting or offline.
   *  3. Aura unavailable: wait for Puck to finish downloading (small "Getting Wilson's voice ready…" note).
   *  4. Nothing works: skip the piece and show a small note. Later pieces still get their chance.
   */
  dbg(`voice engine: ${getPuckState() === "ready" ? "Puck (on device)" : "Aura (server) until Puck is ready"}`);
  /** Puck ready (waiting for its download if needed)? */
  const puckReady = async (): Promise<boolean> => {
    if (getPuckState() === "ready") return true;
    if (!puckSupported() && getPuckState() === "off") return false;
    if (getPuckState() !== "failed") setStatus({ state: "preparing", progress: getPuckProgress() });
    const ok = await waitForPuck(PUCK_WAIT_MS);
    if (status.state === "preparing") setStatus(ok ? { state: "ready" } : noVoiceStatus());
    return ok && my === generation;
  };
  /** One short piece with Puck; one retry (covers a worker restart after a crash). */
  const puckPiece = async (t: string): Promise<Blob | null> => {
    for (let i = 0; i < 2 && my === generation; i++) {
      if (!(await puckReady())) return null;
      const t0 = Date.now();
      const b = await puckSynth(t, speed, my);
      if (my !== generation) return null;
      if (b) { dbg(`puck ${(b.size / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return b; }
      dbg("puck clip failed" + (i === 0 ? ", retrying" : ""));
    }
    return null;
  };
  /** Split into short pieces and queue them all on the worker at once (it runs them in order, back to back). */
  const viaPuck = async (t: string, first: boolean): Promise<Promise<Blob | null>[] | null> => {
    if (!(await puckReady())) return null;
    return splitForPuck(t, first).map((p) => { const pr = puckPiece(p); pr.catch(() => {}); return pr; });
  };
  const clip = async (t: string, first: boolean): Promise<Promise<Blob | null>[]> => {
    if (getPuckState() === "ready") {
      const parts = await viaPuck(t, first);
      if (parts || my !== generation) return parts ?? [];
    }
    if (!isVoiceResting() && !serverDown) {
      try {
        await slot(); inflight++;
        try { return [Promise.resolve(await fetchClip(t, speed, my))]; }
        finally { inflight--; waiters.shift()?.(); }
      } catch { if (my !== generation) return []; }
    }
    // Server voice can't help (daily limit, offline...): wait for Puck instead of going silent.
    const parts = await viaPuck(t, first);
    if (parts || my !== generation) return parts ?? [];
    throw new Error("no voice available");
  };

  const playLoop = async () => {
    if (playing) return; playing = true;
    while (playIdx < queue.length && my === generation) {
      if (!played) setPending(true);
      let parts: Promise<Blob | null>[] = [];
      try { parts = await queue[playIdx]; } catch { if (status.state !== "preparing") setStatus(noVoiceStatus()); }
      for (let pi = 0; pi < parts.length && my === generation; pi++) {
        let buf: Blob | null = null;
        try { buf = await parts[pi]; } catch { /* ignore */ }
        if (!buf || my !== generation) continue;
        // When Puck is slow, wait a bit for the next piece so the gap between clips is smaller.
        // This keeps the paragraph feeling continuous instead of stop-start.
        if (!played && puckStats.rtf > 1.05) {
          const next = parts[pi + 1] ?? (playIdx + 1 < queue.length ? queue[playIdx + 1].then((ps) => ps[0] ?? null) : null);
          if (next) await Promise.race([next.catch(() => null), new Promise((r) => setTimeout(r, 6000))]);
          if (my !== generation) break;
        }
        setPending(false);
        if (!played) hooks.onStart?.();
        played = true;
        if (status.state === "idle" || status.state === "unavailable") setStatus({ state: "ready", reason: undefined });
        await playBlob(buf, my);
      }
      if (my !== generation) break;
      playIdx++;
    }
    playing = false;
    if (my !== generation) return;
    if (done && playIdx >= queue.length) { setPending(false); end(); }
  };

  const dispatch = (text: string) => {
    const t = toSpeakable(text);
    if (!t) return;
    spoken.push(t);
    const pr = clip(t, queue.length === 0); pr.catch(() => {}); queue.push(pr);
    void playLoop();
  };

  const flush = (force: boolean) => {
    // Avoid dispatching every short sentence as a separate Puck clip when the
    // server-request counter is idle. Accumulate a fuller clip, but keep
    // streaming once the buffer reaches the conversational chunk target.
    if (buffer && (force || buffer.length >= SOFT_CHUNK_MAX)) { dispatch(buffer); buffer = ""; }
  };

  const feed = (text: string, final: boolean) => {
    if (my !== generation) return;
    const { parts, next } = takeChunks(text, offset, final, !sentFirst);
    offset = next;
    for (const p of parts) {
      if (!sentFirst) {
        sentFirst = true;
        dispatch(p);           // first usable tokens → speak immediately
        continue;
      }
      // Keep the merge buffer but at the new tighter MERGE_MAX
      if (buffer && buffer.length + 1 + p.length > MERGE_MAX) {
        dispatch(buffer);
        buffer = p;
      } else {
        buffer = buffer ? buffer + " " + p : p;
      }
    }
    flush(final);
  };

  if (serverDown && getPuckState() !== "ready" && getPuckState() !== "loading" && !puckSupported()) {
    setStatus(noVoiceStatus());
    return { push: () => {}, finish: () => { end(); } };
  }
  setPending(true);
  setActive(true);
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

/** Speak one finished message with Wilson's voice (sentence-chunked). Works regardless of the auto-voice setting. */
/** Settings → "Voice test": call from a tap. */
export function voiceTest(): void {
  dbg(`voice test tapped (Puck: ${getPuckState()})`);
  speakMessage("Hi Jenny, it's Wilson. If you can hear me, my voice is working!");
}

export function speakMessage(text: string, speed: number = SPEED, hooks: StreamHooks = {}): void {
  primePlayback();
  startSpeechStream(speed, hooks).finish(text);
}

/** Speak a full text with Wilson's voice. Resolves when playback ends (or the voice failed: silent). */
export function speak(text: string, speed: number = SPEED): Promise<SpeakResult> {
  return new Promise((resolve) => {
    let started = false;
    startSpeechStream(speed, { onStart: () => { started = true; }, onEnd: () => resolve(started ? "success" : "skipped") }).finish(text);
  });
}
