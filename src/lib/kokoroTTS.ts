/**
 * Wilson's voice — ONE locked voice per session (Settings → "Wilson's voice"; default Edge Andrew).
 *
 *  - The locked voice speaks every piece of every reply. There is NO per-piece fallback to another voice:
 *    switching engines mid-reply is what made Wilson sound like several different people.
 *  - Every piece is spoken, in order. A piece that fails is retried on the SAME voice with a short backoff
 *    (the first piece is also "hedged": two identical requests, first one back wins). If it still can't be
 *    voiced, the rest of that reply stays text-only and a small "voice is down" note appears — no skipping
 *    ahead to later paragraphs.
 *  - Low lag: the first sentence is sent the moment it streams in; later pieces are prefetched in parallel
 *    while the current one plays. The ~92 MB on-device Kokoro model is never touched unless the locked voice
 *    is "On-device Puck".
 *
 * Voices (all male):
 *   edge-andrew  Edge Andrew (en-US-AndrewMultilingualNeural) via the Wilson worker /tts/edge — free, no daily cap
 *   gemini       Gemini Fenrir via worker /tts/gemini-puck — free tier, daily limit
 *   aura-orion   Deepgram Aura-2 Orion via worker /tts — free tier, daily limit
 *   puck-device  On-device Kokoro (am_michael) — free/unlimited after a one-time ~92 MB download
 *
 * Playback: ONE reused HTMLAudioElement (playsinline), unlocked by playing a silent clip inside the first tap.
 * HTMLAudioElement is not muted by the iPhone ringer switch the way Web Audio is, and avoids
 * AudioContext "suspended"/"interrupted" states in home-screen PWAs. Web Audio is only used for
 * the orb's analyser on non-iOS browsers (audioBus.attachAudio bypasses it on iOS/Safari).
 */
import { attachAudio, detachAudio, setSpeakingFlag, unlockAudioContext } from "./audioBus";
import { primeScreenAwake } from "./screenAwake";
import { ensurePuck, getPuckProgress, getPuckState, puckBlockedReason, puckCancel, puckSupported, puckSynth, subscribePuck, waitForPuck } from "./puckVoice";
import { createOrderedSpeaker, FatalVoiceError, firstSuccess, splitAtPauses, takeChunks, withRetry } from "./voiceQueue";

/* ---- the locked voice (one per session; changed only from Settings) ---- */
export type VoiceId = "edge-andrew" | "gemini" | "aura-orion" | "puck-device";
export const VOICE_OPTIONS: { id: VoiceId; label: string; note: string }[] = [
  { id: "edge-andrew", label: "Andrew", note: "Soft, warm male voice · free, no daily limit (default)" },
  { id: "gemini", label: "Fenrir", note: "Google Gemini male voice · free daily limit" },
  { id: "aura-orion", label: "Orion", note: "Deepgram male voice · free daily limit" },
  { id: "puck-device", label: "Puck (on this phone)", note: "Runs on your phone · one-time ~92 MB download, can be slow on older phones" },
];
const LOCK_KEY = "wilson-voice-lock";
const isVoiceId = (v: unknown): v is VoiceId => VOICE_OPTIONS.some((o) => o.id === v);
let lockedVoice: VoiceId = (() => { try { const v = localStorage.getItem(LOCK_KEY); return isVoiceId(v) ? v : "edge-andrew"; } catch { return "edge-andrew"; } })();
const lockListeners = new Set<(v: VoiceId) => void>();
export function getLockedVoice(): VoiceId { return lockedVoice; }
export function voiceLabel(v: VoiceId = lockedVoice): string { return VOICE_OPTIONS.find((o) => o.id === v)?.label ?? v; }
export function subscribeLockedVoice(l: (v: VoiceId) => void) { lockListeners.add(l); return () => { lockListeners.delete(l); }; }
/**
 * Settings → pick Wilson's voice. Takes effect from the next reply (a reply already being spoken keeps its voice).
 * Call from a tap: picking on-device Puck starts its one-time download right away.
 */
export function setLockedVoice(v: VoiceId): void {
  if (!isVoiceId(v)) return;
  lockedVoice = v;
  try { localStorage.setItem(LOCK_KEY, v); } catch { /* private mode */ }
  dbg(`voice locked to ${voiceLabel(v)}`);
  if (status.state !== "idle") setStatus({ state: "ready", reason: undefined });
  if (v === "puck-device" && puckSupported()) ensurePuck(); // may flip the note to "preparing" (download progress)
  lockListeners.forEach((l) => l(v));
}
export function puckPickBlockedReason(): string { return puckSupported() ? "" : (puckBlockedReason() || "this device can't run the on-device voice"); }

/* ---- which voice is speaking (shown in Settings → Voice) ---- */
export type VoiceName = string;
export type VoicePlaying = { now: VoiceName; last: VoiceName; lastAt: number };
let playingVoice: VoicePlaying = (() => { try { const r = localStorage.getItem("wilson-voice-last"); if (r) return { now: "", ...JSON.parse(r) } as VoicePlaying; } catch { /* ignore */ } return { now: "", last: "", lastAt: 0 }; })();
const playingListeners = new Set<(v: VoicePlaying) => void>();
function setPlayingVoice(now: VoiceName) {
  if (now === playingVoice.now) return;
  playingVoice = now ? { now, last: now, lastAt: Date.now() } : { ...playingVoice, now: "" };
  if (now) try { localStorage.setItem("wilson-voice-last", JSON.stringify({ last: now, lastAt: playingVoice.lastAt })); } catch { /* ignore */ }
  playingListeners.forEach((l) => l(playingVoice));
}
export function getVoicePlaying() { return playingVoice; }
export function subscribeVoicePlaying(l: (v: VoicePlaying) => void) { playingListeners.add(l); return () => { playingListeners.delete(l); }; }

const SPEED = 1.1;
const PROXY = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev");
const SERVER_TTS_URL = PROXY + "/tts";
const GEMINI_TTS_URL = PROXY + "/tts/gemini-puck";
const EDGE_TTS_URL = PROXY + "/tts/edge";
/** The comforting soft male voice Jenny likes (Microsoft's Copilot-style voice). */
const EDGE_VOICE = "en-US-AndrewMultilingualNeural";
const SILENT_MP3 = "data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYxLjcuMTAzAAAAAAAAAAAAAAD/84TAAAAAAAAAAAAASW5mbwAAAA8AAAAFAAACoABtbW1tbW1tbW1tbW1tbW1tbW1tkpKSkpKSkpKSkpKSkpKSkpKSkpK2tra2tra2tra2tra2tra2tra2ttvb29vb29vb29vb29vb29vb29vb//////////////////////////8AAAAATGF2YzYxLjE5AAAAAAAAAAAAAAAAJARQAAAAAAAAAqC9P8vrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/80TEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEUwAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy7/80TEpgAAA0gAAAAAMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80TErAAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";
let generation = 0;
let unlocked = false;
let el: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let finishCurrentClip: (() => void) | null = null;
/** In-flight voice requests of the current reply (aborted on stop so they don't hog connections). */
const inflightCtrls = new Set<AbortController>();

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
/** "unavailable": the locked voice is down for this reply (text stays); "preparing": on-device Puck downloading. */
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
  // Create/resume Web Audio synchronously during the tap, before async TTS fetches.
  // Otherwise Chrome/Samsung browsers can leave the later MediaElementSource silent.
  void unlockAudioContext();
  primeScreenAwake(); // same tap lets the iOS Home Screen keep-awake fallback start later
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
  inflightCtrls.forEach((c) => { try { c.abort(); } catch { /* ignore */ } }); inflightCtrls.clear();
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

/** Play one audio blob on the shared element; resolves true when it ends, false if playback itself failed. */
function playBlob(blob: Blob, my: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (my !== generation) return resolve(true);
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
    const settle = (ok: boolean) => {
      if (settled) return; settled = true;
      cleanup();
      if (finishCurrentClip === done) finishCurrentClip = null;
      resolve(ok);
    };
    const done = () => settle(true);
    const fail = (why: string) => { dbg("audio playback failed", why); settle(false); };
    const onErr = () => fail(a.error ? `MediaError code ${a.error.code} ${a.error.message ?? ""}` : "unknown media error");
    // iOS may interrupt playback temporarily. Give the same clip several bounded resume attempts.
    const resumeAfterPause = () => {
      if (settled || my !== generation || a.ended || !a.paused) return;
      if (resumeAttempts >= 5) { fail("kept getting interrupted (resume retries exhausted)"); return; }
      const delay = Math.min(2000, 250 * (2 ** resumeAttempts++));
      setTimeout(() => {
        if (settled || my !== generation || a.ended || !a.paused) return;
        a.play().catch((e) => { dbg("resume play() rejected", e); resumeAfterPause(); });
      }, delay);
    };
    const onPause = () => { if (settled || my !== generation || a.ended) return; resumeAfterPause(); };
    const armStall = () => {
      if (stall) clearTimeout(stall);
      const secs = isFinite(a.duration) && a.duration > 0 ? a.duration : 60;
      // Duration known and well past: it played (some WebViews never fire "ended").
      stall = setTimeout(() => { dbg("clip never fired 'ended', moving on"); done(); }, secs * 1000 + 5000);
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
        if (playAttempts < 4 && !settled && my === generation) setTimeout(tryPlay, Math.min(1600, 300 * (2 ** (playAttempts - 1))));
        else if (!settled) fail(`browser rejected audio playback: ${errText(e)}`);
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
  return s.trim();
}

let pending = false;
const pendingListeners = new Set<(p: boolean) => void>();
function setPending(p: boolean) { if (p !== pending) { pending = p; pendingListeners.forEach((l) => l(p)); } }
/** True while voice audio has been requested but nothing is playing yet ("getting ready to speak"). */
export function subscribeVoicePending(l: (p: boolean) => void) { pendingListeners.add(l); return () => { pendingListeners.delete(l); }; }

/** Typing / opening: only on-device Puck needs warming, and only when it's the locked voice. */
export function warmVoice(): void { if (lockedVoice === "puck-device" && getPuckState() === "off" && puckSupported()) ensurePuck(); }

// On-device Puck download progress → the small "getting Wilson's voice ready" note (only when Puck is the locked voice).
subscribePuck(() => {
  if (lockedVoice !== "puck-device") return;
  const p = getPuckState();
  if (p === "loading") setStatus({ state: "preparing", progress: getPuckProgress() });
  else if (p === "ready" && status.state === "preparing") setStatus({ state: "ready", reason: undefined, progress: 100 });
  else if (p === "failed" && status.state === "preparing") setStatus({ state: "unavailable", reason: `Puck couldn't start on this phone${puckBlockedReason() ? `: ${puckBlockedReason()}` : ""}. Pick another voice in Settings` });
});

/* ---- client-side clip cache (IndexedDB) so replays don't spend the daily voice allowance ---- */
const IDB_NAME = "wilson-voice", IDB_STORE = "clips";
let idbP: Promise<IDBDatabase | null> | null = null;
/** Resolve to `fallback` if `p` hasn't settled in `ms` (iOS can leave IndexedDB / Cache Storage calls pending forever). */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((res) => { const t = setTimeout(() => res(fallback), ms); p.then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(fallback); }); });
}
const IDB_OPEN_MS = 1500, IDB_GET_MS = 350; // a cache lookup must never be the reason Wilson is slow to start
function idb(): Promise<IDBDatabase | null> {
  if (!idbP) idbP = within(new Promise<IDBDatabase | null>((res) => {
    try {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  }), IDB_OPEN_MS, null).then((db) => { if (!db) dbg("voice clip cache unavailable (skipped)"); return db; });
  return idbP;
}
// Open the cache early (cheap) so the first lookup doesn't pay the open cost.
try { if (typeof indexedDB !== "undefined") setTimeout(() => void idb(), 0); } catch { /* ignore */ }
async function clipKey(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("apollo|" + text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function cacheGet(key: string, type: string): Promise<Blob | null> {
  const db = await within(idb(), IDB_GET_MS, null); if (!db) return null;
  return within(new Promise<Blob | null>((res) => {
    try {
      const q = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
      q.onsuccess = () => res(q.result ? new Blob([q.result as ArrayBuffer], { type }) : null);
      q.onerror = () => res(null);
    } catch { res(null); }
  }), IDB_GET_MS, null);
}
async function cachePut(key: string, blob: Blob) {
  const db = await idb(); if (!db) return;
  try { const buf = await blob.arrayBuffer(); db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(buf, key); } catch { /* quota */ }
}

/* ---- daily-limit bookkeeping for the capped voices ---- */
const REST_KEY = "wilson-aura-resting-until";
let restingUntil = (() => { try { return Number(localStorage.getItem(REST_KEY)) || 0; } catch { return 0; } })();
function nextResetUtcMidnight() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
function markResting() { restingUntil = nextResetUtcMidnight(); try { localStorage.setItem(REST_KEY, String(restingUntil)); } catch { /* ignore */ } }
export function isVoiceResting() { return Date.now() < restingUntil; }
const G_REST_KEY = "wilson-gpuck-resting-until";
let gRestUntil = (() => { try { return Number(localStorage.getItem(G_REST_KEY)) || 0; } catch { return 0; } })();
let gToday = 0;
export function geminiRestingUntil() { return gRestUntil > Date.now() ? gRestUntil : 0; }
export function geminiUsedToday() { return gToday; }

/* ---- one request to the locked voice (no fallbacks; retries live in synthPiece) ---- */
type Engine = { id: VoiceId; type: string; timeoutMs: number; once: (text: string, signal: AbortSignal) => Promise<Blob> };
async function post(url: string, body: unknown, signal: AbortSignal) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}
const ENGINES: Record<Exclude<VoiceId, "puck-device">, Engine> = {
  "edge-andrew": {
    id: "edge-andrew", type: "audio/mpeg", timeoutMs: 14000,
    async once(text, signal) {
      const res = await post(EDGE_TTS_URL, { text, voice: EDGE_VOICE }, signal);
      if (res.status === 404) throw new FatalVoiceError("Andrew isn't on the voice server (404)", "missing");
      if (!res.ok) throw new Error("edge tts http " + res.status);
      const blob = await res.blob();
      if (blob.size < 500) throw new Error("edge tts empty audio");
      return new Blob([blob], { type: "audio/mpeg" });
    },
  },
  gemini: {
    id: "gemini", type: "audio/wav", timeoutMs: 15000,
    async once(text, signal) {
      if (geminiRestingUntil()) throw new FatalVoiceError(`Fenrir is resting until ${new Date(gRestUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (daily free limit)`, "limit");
      const res = await post(GEMINI_TTS_URL, { text, voice: "Fenrir", voiceGender: "male" }, signal);
      if (res.status === 429) {
        let j: { daily?: boolean; until?: number } = {}; try { j = await res.json(); } catch { /* ignore */ }
        if (j.daily && j.until) { gRestUntil = j.until; try { localStorage.setItem(G_REST_KEY, String(j.until)); } catch { /* ignore */ } throw new FatalVoiceError("Fenrir's daily free limit is used up", "limit"); }
        throw new Error("Fenrir busy (429)"); // short rate limit: retry the same voice after a backoff
      }
      if (!res.ok) throw new Error("gemini tts http " + res.status);
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error("gemini tts empty audio");
      const n = Number(res.headers.get("X-Voice-Today")); if (n) gToday = n;
      return blob.type ? blob : new Blob([blob], { type: "audio/wav" });
    },
  },
  "aura-orion": {
    id: "aura-orion", type: "audio/mpeg", timeoutMs: 15000,
    async once(text, signal) {
      if (isVoiceResting()) throw new FatalVoiceError("Orion's daily free limit is used up", "limit");
      const res = await post(SERVER_TTS_URL, { text, speed: SPEED, voice: "aura-2-orion-en", voiceGender: "male" }, signal);
      if (res.status === 503) throw new FatalVoiceError("Orion isn't configured on the voice server (503)", "missing");
      if (res.status === 429) { markResting(); throw new FatalVoiceError("Orion's daily free limit is used up", "limit"); }
      if (!res.ok) throw new Error("tts http " + res.status);
      const blob = await res.blob();
      if (blob.size < 100) throw new Error("tts empty audio");
      return blob.type ? blob : new Blob([blob], { type: "audio/mpeg" });
    },
  },
};

/** One request with its own timeout; aborted if the reply is stopped. */
async function requestOnce(e: Engine, text: string, my: number): Promise<Blob> {
  if (my !== generation) throw new Error("stopped");
  const ctrl = new AbortController(); inflightCtrls.add(ctrl);
  const to = setTimeout(() => ctrl.abort(), e.timeoutMs);
  const t0 = Date.now();
  try {
    const b = await e.once(text, ctrl.signal);
    dbg(`${voiceLabel(e.id)} ${(b.size / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return b;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error(my !== generation ? "stopped" : `${voiceLabel(e.id)} timed out after ${e.timeoutMs / 1000}s`);
    throw err;
  } finally { clearTimeout(to); inflightCtrls.delete(ctrl); }
}

/** Retry policy: same voice, short backoff, bounded overall so a dead voice is reported instead of hanging. */
const RETRY = { attempts: 4, backoffMs: [350, 1000, 2200], deadlineMs: 40000 };

/** Voice one piece with the locked voice. Throws only after the same voice failed every retry. */
async function synthPiece(voice: VoiceId, text: string, index: number, my: number, speed: number, gaveUp: () => boolean): Promise<Blob> {
  const stopped = () => my !== generation || gaveUp();
  if (voice === "puck-device") {
    return withRetry(async () => {
      if (getPuckState() === "off") ensurePuck();
      const ok = getPuckState() === "ready" || await waitForPuck(index === 0 ? 120000 : 60000);
      if (stopped()) throw new Error("stopped");
      if (!ok) throw new FatalVoiceError(`Puck couldn't start on this phone${puckBlockedReason() ? `: ${puckBlockedReason()}` : ""}`, "missing");
      const b = await puckSynth(text, speed, my, "am_michael");
      if (!b) throw new Error("Puck couldn't voice this piece");
      return b;
    }, { attempts: 3, backoffMs: [300, 1000], stopped, onRetry: (a, e) => dbg(`Puck retry ${a}`, e) });
  }
  const e = ENGINES[voice];
  const key = await clipKey(`${voice}|${voice === "edge-andrew" ? EDGE_VOICE : ""}|${text}`).catch(() => "");
  if (key) { const hit = await cacheGet(key, e.type); if (hit) { dbg(`${voiceLabel(voice)} clip from device cache`); return hit; } }
  const b = await withRetry((attempt) => {
    // Edge is uncapped: hedge the first piece and every retry with two identical requests (first back wins),
    // which cuts both the long first-byte waits and the intermittent "closed without audio" failures.
    if (voice === "edge-andrew" && (index === 0 || attempt > 0)) return firstSuccess([requestOnce(e, text, my), requestOnce(e, text, my)]);
    return requestOnce(e, text, my);
  }, { ...RETRY, stopped, onRetry: (a, err) => dbg(`${voiceLabel(voice)} retry ${a} for piece ${index + 1}`, err) });
  if (key) void cachePut(key, b);
  return b;
}

/* ---------------- streaming voice ---------------- */
/** Pieces grow as the reply goes on (fewer requests): first = one sentence, 2nd ~140 chars, then ~260. */
const pieceTarget = (idx: number) => (idx === 0 ? 1 : idx === 1 ? 140 : 260);
const PIECE_MAX = 300;
const CONCURRENCY = 3; // pieces being voiced at once while one plays

export type SpeechStream = { push: (textSoFar: string) => void; finish: (finalText: string) => void };
export type StreamHooks = { onStart?: () => void; onEnd?: () => void };
let endCurrent: (() => void) | null = null;

/**
 * Start speaking a reply while it is still streaming. Call push() with the full displayed text so far,
 * then finish() with the final text. Every piece uses the voice locked when the reply started.
 */
export function startSpeechStream(speed: number = SPEED, hooks: StreamHooks = {}): SpeechStream {
  stopSpeaking();
  const my = generation;
  const voice = lockedVoice;          // locked for this whole reply
  const label = voiceLabel(voice);
  let ended = false;
  const end = () => { if (!ended) { ended = true; if (endCurrent === end) { endCurrent = null; setActive(false); } setPending(false); if (playingVoice.now) setPlayingVoice(""); hooks.onEnd?.(); } };
  endCurrent = end;
  let offset = 0, buffer = "", sentFirst = false, done = false, fullText = "";
  let dispatched = 0, gaveUp = false;
  dbg(`voice locked for this reply: ${label}`);

  const speaker = createOrderedSpeaker<Blob>({
    concurrency: CONCURRENCY,
    lookahead: 5,
    stopped: () => my !== generation,
    synth: (t, i) => synthPiece(voice, t, i, my, speed, () => gaveUp),
    play: (b) => playBlob(b, my),
    onFirstPlay: () => {
      setPending(false);
      hooks.onStart?.();
      if (status.state !== "preparing" || voice !== "puck-device") setStatus({ state: "ready", reason: undefined });
    },
    onPlay: () => { setPlayingVoice(label); maybeFlush(); },
    onDown: (i, err) => {
      gaveUp = true; // stop retrying the pieces after this one; they won't be played
      const msg = String((err as Error)?.message || err);
      const resting = err instanceof FatalVoiceError && err.kind === "limit";
      dbg(`${label} is down at piece ${i + 1} of ${speaker.queued}; rest of this reply stays text`, err);
      setStatus({ state: resting ? "resting" : "unavailable", reason: `${label}: ${msg}${i > 0 ? ". He stopped partway; the rest is in the text" : ""}` });
    },
    onEnd: () => end(),
  });

  const dispatch = (text: string) => {
    const t = toSpeakable(text);
    if (!t) return;
    // On-device Puck is faster on short pieces; cloud voices get whole sentences (fewer requests, natural prosody).
    const pieces = voice === "puck-device" ? splitAtPauses(t, dispatched === 0) : [t];
    for (const p of pieces) { speaker.push(p); dispatched++; }
  };
  /* Gather sentences into bigger pieces, but never let the speaker run dry: when nothing is queued behind
     the piece now playing, send what we have (at least ~40 chars). */
  const starving = () => speaker.played > 0 && speaker.backlog() <= 1;
  const flush = (force: boolean) => {
    if (buffer && (force || buffer.length >= pieceTarget(dispatched) || (starving() && buffer.length >= 40))) { dispatch(buffer); buffer = ""; }
  };
  function maybeFlush() { if (!done && buffer) flush(false); }

  const feed = (text: string, final: boolean) => {
    if (my !== generation) return;
    const { parts, next } = takeChunks(text, offset, final, !sentFirst);
    offset = next;
    for (const p of parts) {
      if (!sentFirst) { sentFirst = true; dispatch(p); continue; } // first sentence → speak immediately
      if (buffer && buffer.length + 1 + p.length > Math.min(PIECE_MAX, Math.max(pieceTarget(dispatched), 140))) { dispatch(buffer); buffer = p; }
      else buffer = buffer ? buffer + " " + p : p;
    }
    flush(final);
  };

  setPending(true);
  setActive(true);
  if (voice === "puck-device" && getPuckState() !== "ready") setStatus({ state: "preparing", progress: getPuckProgress() });
  return {
    push: (t) => { fullText = t; feed(t, false); },
    finish: (t) => {
      if (my !== generation || done) return;
      // Final text may differ from streamed text (tags stripped). If what we've already consumed isn't a prefix
      // of the final text, resume from the longest common prefix so nothing is skipped.
      if (!t.startsWith(fullText.slice(0, offset))) { let k = 0; while (k < offset && k < t.length && t[k] === fullText[k]) k++; offset = k; }
      fullText = t; done = true; feed(t, true);
      speaker.finish();
    },
  };
}

/** Settings → "Voice test": call from a tap. */
export function voiceTest(): void {
  dbg(`voice test tapped (${voiceLabel()})`);
  speakMessage("Hi Jenny, it's Wilson. If you can hear me, my voice is working!");
}

/** Speak one finished message with Wilson's voice (sentence-chunked). Works regardless of the auto-voice setting. */
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
