/**
 * Wilson's voice, in this order (per piece of a reply):
 * 1) Gemini Puck: Google's prebuilt "Puck" voice through the Wilson worker /tts/gemini-puck (key stays on the
 *    server; WAV; free tier, daily limit resets at midnight Pacific). Fast (~4x real time), so pieces play back to back.
 * 2) On-device Kokoro "Puck" (am_puck, puckVoice.ts) ONLY if its ~92 MB model is already saved on this device.
 *    Wilson never starts that download by itself (Settings → Voice has a button for it).
 * 3) Deepgram Aura-2 (arcas) via Cloudflare Workers AI through the worker /tts (MP3).
 * 4) If nothing works, Wilson stays text-only with a small note (never the phone's built-in voice).
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
