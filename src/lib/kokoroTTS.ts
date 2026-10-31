/**
 * Wilson's voice, in this order (per piece of a reply):
 * 1) On-device Kokoro (puckVoice.ts): free local synthesis with no daily usage quota once its model is downloaded.
 *    It is preferred whenever the model is saved; it never starts the ~92 MB download without the user's action.
 * 2) Gemini Puck through the Wilson worker /tts/gemini-puck (free tier, daily limit).
 * 3) Deepgram Aura-2 (arcas) through the Wilson worker /tts (free tier, daily limit).
 * 4) If every available engine fails, Wilson stays text-only with a clear status note.
 * Playback: ONE reused HTMLAudioElement (playsinline), unlocked by playing a silent clip inside the first tap.
 * HTMLAudioElement is not muted by the iPhone ringer switch the way Web Audio is, and avoids
 * AudioContext "suspended"/"interrupted" states in home-screen PWAs. Web Audio is only used for
 * the orb's analyser on non-iOS browsers (audioBus.attachAudio bypasses it on iOS/Safari).
 */
import { attachAudio, detachAudio, setSpeakingFlag } from "./audioBus";
import { ensurePuck, getPuckFail, getPuckState, puckBlockedReason, puckCancel, puckOnDisk, puckOnDiskKnown, puckSupported, puckSynth, subscribePuck, waitForPuck } from "./puckVoice";

/** Start on-device Puck in an idle moment, but only if its model is already saved here (never the 92 MB download). */
function schedulePuck() {
  if (getPuckState() !== "off") return;
  void puckOnDisk().then((yes) => {
    if (!yes || getPuckState() !== "off") return;
    const ric = (globalThis as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
    if (ric) ric(() => ensurePuck(), { timeout: 3000 }); else setTimeout(() => ensurePuck(), 1500);
  });
}
/** On-device Puck can help right now (loaded, or saved on this device and starting). */
function puckUsable(): boolean {
  const st = getPuckState();
  return st === "ready" || (st === "loading" && puckOnDiskKnown() === true);
}

/* ---- which voice is speaking (shown in Settings → Voice test) ---- */
export type VoiceName = "Gemini Puck" | "Puck (on this phone)" | "arcas" | "";
export type VoicePlaying = { now: VoiceName; last: VoiceName; lastAt: number };
let playingVoice: VoicePlaying = (() => { try { const r = localStorage.getItem("wilson-voice-last"); if (r) return { now: "", ...JSON.parse(r) } as VoicePlaying; } catch { /* ignore */ } return { now: "", last: "", lastAt: 0 }; })();
const playingListeners = new Set<(v: VoicePlaying) => void>();
function setPlayingVoice(now: VoiceName) {
  playingVoice = now ? { now, last: now, lastAt: Date.now() } : { ...playingVoice, now: "" };
  if (now) try { localStorage.setItem("wilson-voice-last", JSON.stringify({ last: now, lastAt: playingVoice.lastAt })); } catch { /* ignore */ }
  playingListeners.forEach((l) => l(playingVoice));
}
export function getVoicePlaying() { return playingVoice; }
export function subscribeVoicePlaying(l: (v: VoicePlaying) => void) { playingListeners.add(l); return () => { playingListeners.delete(l); }; }
const voiceOf = new WeakMap<Blob, VoiceName>();
const tag = (b: Blob | null, v: VoiceName) => { if (b) voiceOf.set(b, v); return b; };

const SPEED = 1.1;
const PROXY = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev");
const SERVER_TTS_URL = PROXY + "/tts";
const GEMINI_TTS_URL = PROXY + "/tts/gemini-puck";
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
  if (playingVoice.now) setPlayingVoice("");
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
    let resumeAttempts = 0;
    let playAttempts = 0;
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
    // iOS may interrupt playback temporarily. Give the same clip several bounded resume attempts
    // instead of abandoning it after two pauses, which can make Wilson skip words mid-answer.
    const resumeAfterPause = () => {
      if (settled || my !== generation || a.ended || !a.paused) return;
      if (resumeAttempts >= 5) { dbg("audio resume retries exhausted"); done(); return; }
      const delay = Math.min(2000, 250 * (2 ** resumeAttempts++));
      setTimeout(() => {
        if (settled || my !== generation || a.ended || !a.paused) return;
        a.play().catch((e) => {
          dbg("resume play() rejected", e);
          resumeAfterPause();
        });
      }, delay);
    };
    const onPause = () => {
      if (settled || my !== generation || a.ended) return;
      resumeAfterPause();
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
    const tryPlay = () => {
      if (settled || my !== generation) return;
      playAttempts++;
      const p = a.play();
      if (p && typeof p.then === "function") p.then(() => dbg(`playing ${(blob.size / 1024).toFixed(0)} KB`), (e) => {
        dbg("play() rejected", e);
        if (playAttempts < 4 && !settled && my === generation) {
          setTimeout(tryPlay, Math.min(1600, 300 * (2 ** (playAttempts - 1))));
        } else if (!settled) {
          dbg("play retries exhausted");
          done();
        }
      });
    };
    tryPlay();
  });
}

/** Strip markdown, emoji, tags, and any leading style/tone announcements so only clean words are spoken. */
export function toSpeakable(text: string): string {
  let s = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_#>~|<>{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Drop leading stage directions the model sometimes emits despite the system prompt
  s = s.replace(/^(?:say\s+)?in\s+a\s+(?:warm|relaxed|friendly|calm|gentle|steady|soft|bright|excited|neutral)(?:\s*,?\s*(?:warm|relaxed|friendly|calm|gentle|steady|soft|bright|excited|neutral))*\s+(?:voice|tone|way)\s*[,.:;\-–—]*\s*/i, "");
  s = s.replace(/^(?:\*\s*)?(?:in\s+a\s+)?(?:warm|relaxed|friendly|calm|gentle)\s+(?:voice|tone)\s*\*?\s*[,.:;\-–—]*\s*/i, "");
  return s.trim().slice(0, 1500);
}

/* ---------------- streaming voice (continuous chunking) ---------------- */
const MAX_PARALLEL = 2;
const MERGE_MAX = 180;          // tighter for conversational cadence (was 250)
const FIRST_CHUNK_MAX = 90;     // fire the first words fast (a short first sentence; Gemini sounds odd cut mid-sentence)
const SOFT_CHUNK_MAX = 160;     // soft break for long run-on text without punctuation
/** Pieces grow as the reply goes on (fewer requests): 2nd piece ~160 chars, then up to ~420 (a paragraph). */
const pieceTarget = (idx: number) => (idx <= 1 ? 160 : 420);
const PIECE_MAX = 450;
const CLIP_TIMEOUT_MS = 20000;
/** How long a reply waits for Puck to finish downloading (~92 MB) when the server voice can't help. */
const PUCK_WAIT_MS = 30000; // only used when the model is already saved on this device (loading from storage)
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
  else if (p === "failed" && status.state === "preparing") setStatus(noVoiceStatus());
});

/** What to show when a reply can't be voiced right now. */
function noVoiceStatus(): Partial<VoiceStatus> {
  const f = getPuckFail();
  // Plain reason when we know one; otherwise the real error text (never "couldn't start: couldn't start").
  const detail = f ? (/couldn't start$/.test(f.plain) ? `error: ${f.error.slice(0, 90)}` : f.plain.replace(/\s*\([^)]*\)\s*$/, "")) : "";
  const g = geminiRestingUntil();
  const gWhy = g ? `Gemini Puck is resting until ${new Date(g).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Gemini Puck didn't answer";
  const pWhy = getPuckState() === "failed" ? `on-device Puck couldn't start${detail ? `: ${detail}` : ""}` : puckBlockedReason();
  const why = [gWhy, pWhy, isVoiceResting() ? "arcas is resting (daily free limit)" : "arcas didn't answer"].filter(Boolean).join("; ");
  return { state: g && isVoiceResting() ? "resting" : "unavailable", reason: why };
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
      body: JSON.stringify({ text, speed, voice: "aura-2-orion-en", voiceGender: "male" }), signal: ctrl.signal,
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

/* ---- Gemini Puck (main voice) ---- */
const G_REST_KEY = "wilson-gpuck-resting-until";
let gRestUntil = (() => { try { return Number(localStorage.getItem(G_REST_KEY)) || 0; } catch { return 0; } })();
let gFails = 0; // consecutive non-limit failures (offline etc.): skip Gemini for a minute after 3
let gToday = 0;
export function geminiRestingUntil() { return gRestUntil > Date.now() ? gRestUntil : 0; }
export function geminiUsedToday() { return gToday; }
function geminiUsable() { return Date.now() >= gRestUntil; }
function geminiRest(until: number, daily: boolean) {
  gRestUntil = until;
  if (daily) try { localStorage.setItem(G_REST_KEY, String(until)); } catch { /* ignore */ }
  statusListeners.forEach((l) => l(status));
}
async function fetchGemini(text: string, my: number): Promise<Blob | null> {
  const key = await clipKey("gpuck|" + text).catch(() => "");
  if (key) { const hit = await cacheGet(key); if (hit) { dbg("Gemini Puck clip from device cache"); return new Blob([hit], { type: "audio/wav" }); } }
  if (!geminiUsable()) throw new Error("Gemini Puck resting");
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  const t0 = Date.now();
  try {
    const res = await fetch(GEMINI_TTS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: "Fenrir", voiceGender: "male" }), signal: ctrl.signal });
    if (res.status === 429) {
      let j: { daily?: boolean; until?: number } = {}; try { j = await res.json(); } catch { /* ignore */ }
      const ra = Number(res.headers.get("Retry-After")) || 60;
      geminiRest(j.daily && j.until ? j.until : Date.now() + Math.min(ra, 120) * 1000, !!j.daily);
      throw new Error(j.daily ? "Gemini Puck daily limit reached" : "Gemini Puck busy");
    }
    if (!res.ok) throw new Error("gemini tts http " + res.status);
    const blob = await res.blob();
    if (blob.size < 1000) throw new Error("gemini tts empty audio");
    const n = Number(res.headers.get("X-Voice-Today")); if (n) gToday = n;
    gFails = 0;
    dbg(`Gemini Puck ${(blob.size / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const out = blob.type ? blob : new Blob([blob], { type: "audio/wav" });
    if (key) void cachePut(key, out);
    return my === generation ? out : null;
  } catch (e) {
    if (!/resting|limit|busy/.test(String((e as Error)?.message))) { if (++gFails >= 3) { gFails = 0; geminiRest(Date.now() + 60000, false); } }
    throw e;
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
 * then finish() with the final text. Prefer downloaded on-device Kokoro; use limited cloud voices only as fallbacks.
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
   *  1. On-device Kokoro Puck (downloaded locally; no daily cloud quota).
   *  2. Gemini Puck (limited cloud fallback).
   *  3. arcas / Aura-2 (secondary limited cloud fallback).
   *  4. Nothing works: skip the piece and show a small note (later pieces still get their chance).
   */
  dbg(`voice order: downloaded Kokoro first${geminiUsable() ? " → Gemini Puck fallback" : " → Gemini resting"} → Aura-2 Orion fallback`);
  /** On-device Puck ready (waiting briefly if it's loading from storage)? */
  const puckReady = async (): Promise<boolean> => {
    if (getPuckState() === "ready") return true;
    if (getPuckState() === "failed" || !(await puckOnDisk()) || !puckSupported()) return false;
    const ok = await waitForPuck(PUCK_WAIT_MS);
    return ok && my === generation;
  };
  /** One short piece with Puck; one retry (covers a worker restart after a crash). */
  const puckPiece = async (t: string): Promise<Blob | null> => {
    for (let i = 0; i < 2 && my === generation; i++) {
      if (!(await puckReady())) return null;
      const t0 = Date.now();
      let voice = "am_fenrir";
      try {
        const saved = JSON.parse(localStorage.getItem("wilson_settings_v1") || "{}");
        if (["am_puck", "am_michael", "am_fenrir"].includes(saved.kokoroVoice)) voice = saved.kokoroVoice;
      } catch { /* keep the default voice */ }
      const b = await puckSynth(t, speed, my, voice);
      if (my !== generation) return null;
      if (b) { dbg(`puck ${(b.size / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return tag(b, "Puck (on this phone)"); }
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
    if (my !== generation) return [];

    // PRIMARY: use the downloaded Kokoro model on this device. Never trigger its large download
    // automatically; puckReady() only starts it when the model is already saved locally.
    try {
      const local = await viaPuck(t, first);
      if (local && my === generation) {
        dbg("using downloaded on-device Kokoro (unlimited local voice)");
        return local;
      }
    } catch (e) {
      dbg("on-device Kokoro unavailable; trying cloud fallback", e);
      if (my !== generation) return [];
    }

    // FALLBACK 1: Gemini Puck (limited cloud voice).
    if (geminiUsable()) {
      try {
        await slot(); inflight++;
        try {
          const b = await fetchGemini(t, my);
          if (b || my !== generation) return [Promise.resolve(tag(b, "Gemini Puck"))];
        } finally { inflight--; waiters.shift()?.(); }
      } catch (e) {
        dbg("Gemini Puck fallback failed", e);
        if (my !== generation) return [];
      }
    }
    if (!isVoiceResting() && !serverDown) {
      try {
        await slot(); inflight++;
        try {
          const backup = await fetchClip(t, speed, my);
          if (backup || my !== generation) return [Promise.resolve(tag(backup, "arcas"))];
        } finally { inflight--; waiters.shift()?.(); }
      } catch (e) {
        if (my !== generation) return [];
        dbg("arcas fallback unavailable", e);
      }
    }
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
        // Start playback as soon as the first synthesized clip is ready.
        // Waiting for a second clip here added up to 6 seconds before Wilson spoke,
        // and the !played guard meant this wait only ever affected initial playback.
        setPending(false);
        if (!played) hooks.onStart?.();
        played = true;
        if (status.state === "idle" || status.state === "unavailable" || status.state === "resting") setStatus({ state: "ready", reason: undefined });
        setPlayingVoice(voiceOf.get(buf) || "");
        maybeFlush(); // queue the next piece now if nothing else is waiting
        await playBlob(buf, my);
      }
      if (my !== generation) break;
      playIdx++;
      maybeFlush();
    }
    playing = false;
    if (playingVoice.now) setPlayingVoice("");
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

  /* Save requests: gather sentences into bigger pieces (see pieceTarget), but never let the speaker run dry —
     when the piece now playing is the last one queued, send what we have (at least a full sentence). */
  const starving = () => played && playIdx >= queue.length - 1;
  const flush = (force: boolean) => {
    if (buffer && (force || buffer.length >= pieceTarget(queue.length) || (starving() && buffer.length >= 40))) { dispatch(buffer); buffer = ""; }
  };
  function maybeFlush() { if (!done && buffer) flush(false); }

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
      if (buffer && buffer.length + 1 + p.length > Math.max(pieceTarget(queue.length), Math.min(PIECE_MAX, MERGE_MAX))) {
        dispatch(buffer);
        buffer = p;
      } else {
        buffer = buffer ? buffer + " " + p : p;
      }
    }
    flush(final);
  };

  // Let the local-first clip router probe the on-device cache before declaring voice unavailable.
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
