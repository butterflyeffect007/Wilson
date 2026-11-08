/**
 * Keep the screen awake while Wilson is speaking a reply or listening to the mic, and let it sleep again after.
 *
 * - Uses the Screen Wake Lock API (navigator.wakeLock.request("screen")) where it exists:
 *   Chrome/Edge/Android 84+, Firefox 126+, Safari 16.4+ (iPhone Safari tab).
 * - iPhone/iPad Home Screen app before iOS 18.4: the API exists but does nothing there (WebKit bug 254545), so we
 *   also play a tiny muted, looping, inline video (2.5 KB, never visible, no sound) only while active.
 * - The browser drops wake locks whenever the page is hidden; we re-request on visibilitychange when visible again.
 * - Everything is feature-detected and fails silently: worst case the screen just sleeps like before.
 */
import { subscribeListening, getListening } from "./listeningBus";
import keepAwakeMp4 from "../assets/keep-awake.mp4";

type Sentinel = { released: boolean; release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };
const MAX_HOLD_MS = 10 * 60_000; // safety: never hold the screen on longer than this without a fresh start

let sentinel: Sentinel | null = null;
let requesting = false;
let wanted = false;
let since = 0;
let capTimer: ReturnType<typeof setTimeout> | null = null;
let video: HTMLVideoElement | null = null;
let started = false;
let voiceActive: () => boolean = () => false;

function hasNativeLock(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).wakeLock && typeof (navigator as any).wakeLock.request === "function";
}

/** iOS/iPadOS Home Screen app older than 18.4, where navigator.wakeLock silently does nothing. */
export function needsVideoFallback(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!iOS) return !hasNativeLock(); // other old browsers without the API: try the video too
  const standalone = (navigator as any).standalone === true || !!window.matchMedia?.("(display-mode: standalone)").matches;
  const m = ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/);
  const ver = m ? Number(m[1]) + Number(m[2]) / 100 : 0;
  if (!hasNativeLock()) return true;           // iOS < 16.4
  return standalone && ver > 0 && ver < 18.04; // Home Screen app before 18.4
}

function ensureVideo(): HTMLVideoElement | null {
  if (video) return video;
  if (typeof document === "undefined") return null;
  try {
    const v = document.createElement("video");
    v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", ""); v.setAttribute("muted", "");
    v.setAttribute("aria-hidden", "true"); v.setAttribute("tabindex", "-1"); v.title = "";
    v.muted = true; v.loop = true; (v as any).playsInline = true; v.preload = "auto"; v.disablePictureInPicture = true;
    v.src = keepAwakeMp4;
    Object.assign(v.style, { position: "fixed", left: "0", bottom: "0", width: "1px", height: "1px", opacity: "0.01", pointerEvents: "none", zIndex: "-1" });
    document.body.appendChild(v);
    video = v;
  } catch { video = null; }
  return video;
}

/** Call inside a tap (send / mic / orb / Play) so iOS lets the fallback video start later without another tap. */
export function primeScreenAwake(): void {
  if (!needsVideoFallback()) return;
  const v = ensureVideo(); if (!v) return;
  if (!v.paused) return;
  try {
    const p = v.play();
    if (p && typeof p.then === "function") p.then(() => { if (!wanted) v.pause(); }, () => {});
  } catch { /* ignore */ }
}

async function acquire() {
  if (!wanted || typeof document === "undefined" || document.visibilityState !== "visible") return;
  if (hasNativeLock() && (!sentinel || sentinel.released) && !requesting) {
    requesting = true;
    try {
      const s: Sentinel = await (navigator as any).wakeLock.request("screen");
      if (!wanted) { void s.release().catch(() => {}); } else { sentinel = s; s.addEventListener?.("release", () => { if (sentinel === s) sentinel = null; }); }
    } catch { /* denied (low battery, policy, hidden): fail silently */ }
    finally { requesting = false; }
  }
  if (needsVideoFallback()) { const v = ensureVideo(); if (v && v.paused) { try { await v.play(); } catch { /* not allowed without a tap yet */ } } }
}

function release() {
  const s = sentinel; sentinel = null;
  if (s && !s.released) void s.release().catch(() => {});
  if (video && !video.paused) { try { video.pause(); } catch { /* ignore */ } }
}

function update() {
  const want = voiceActive() || getListening();
  if (want && !wanted) {
    wanted = true; since = Date.now();
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(() => { if (wanted && Date.now() - since >= MAX_HOLD_MS) { wanted = false; release(); } }, MAX_HOLD_MS);
    void acquire();
  } else if (!want && wanted) {
    wanted = false;
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    release();
  }
}

/** Start watching reply-voice + mic state (once, at app start). Voice state is passed in to avoid an import cycle. */
export function startScreenAwake(voice: { isActive: () => boolean; subscribe: (l: (a: boolean) => void) => () => void }): () => void {
  if (started || typeof document === "undefined") return () => {};
  started = true; voiceActive = voice.isActive;
  const unVoice = voice.subscribe(() => update());
  const unMic = subscribeListening(update);
  const onVis = () => { if (document.visibilityState === "visible") void acquire(); };
  document.addEventListener("visibilitychange", onVis);
  update();
  return () => { unVoice(); unMic(); document.removeEventListener("visibilitychange", onVis); wanted = false; release(); started = false; };
}

/** For tests / diagnostics. */
export function screenAwakeState() {
  return { wanted, nativeLock: !!sentinel && !sentinel.released, video: !!video && !video.paused, fallback: needsVideoFallback(), api: hasNativeLock() };
}
