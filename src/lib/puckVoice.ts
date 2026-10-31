/**
 * Controller for Wilson's on-device Kokoro "Puck" voice (see puckWorker.ts).
 * Loaded lazily (first tap / idle moment), never during app start. If anything goes wrong it just
 * reports "unavailable" and the caller uses the Aura-2 server voice instead. Never throws to callers.
 */
import { isIOS } from "./ortSetup";

export type PuckState = "off" | "loading" | "ready" | "failed";

const GUARD_KEY = "wilson-puck-guard"; // crash guard: load attempts that never reached "ready" (per build)
const MAX_ATTEMPTS = 4; // per build; each failed load normally uses 2 (first try + one safe-mode retry)
const MAX_RESTARTS = 2; // worker died after it was ready (e.g. iOS memory pressure): reload from cache this many times per session
/** Time allowed for ONE sentence, counted from when the worker starts it (not from when it was queued). */
// ~14 characters per second of speech; once we know this phone's speed (rtf), allow 2.5x that, else a generous fixed budget.
const synthBudgetMs = (text: string) => rtf ? Math.max(15000, 8000 + (text.length / 14) * rtf * 2500) : 25000 + text.length * 350;
const START_GAP_MS = 20000;
const LOAD_SILENCE_MS = 120000; // worker idle this long while sentences wait = it died silently

let state: PuckState = "off";
let progress = 0;
let worker: Worker | null = null;
let nextId = 1;
let restarts = 0;
let wasReady = false;
type Wait = { resolve: (b: Blob | null) => void; text: string; startedAt: number; queuedAt: number };
const waiting = new Map<number, Wait>();
const readyWaiters: ((ok: boolean) => void)[] = [];
const listeners = new Set<() => void>();
/** Smoothed real-time factor (synth seconds / audio seconds). Informational only (shown in Voice test). */
let rtf = 0;
export type ClipTime = { chars: number; ms: number; secs: number; rtf: number; waitMs: number };
export let puckStats = { loadMs: 0, firstClipMs: 0, bytes: 0, rtf: 0, restarts: 0, threads: 1, coi: false, safe: false, clips: [] as ClipTime[] };
let timingSent = false;
/** Once per session, after 4 sentences: anonymous speed note to the worker (numbers only, no text). */
function reportTiming() {
  if (timingSent || puckStats.clips.length < 4) return; timingSent = true;
  const c = puckStats.clips;
  const t = `threads=${puckStats.threads} coi=${puckStats.coi ? 1 : 0} safe=${puckStats.safe ? 1 : 0} load=${puckStats.loadMs}ms restarts=${puckStats.restarts} rtf=${c.map((x) => x.rtf).join(",")} chars=${c.map((x) => x.chars).join(",")} wait=${c.map((x) => Math.round(x.waitMs / 1000)).join(",")}s`;
  try {
    const url = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev") + "/voice/diag";
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "timing", stage: "speaking", error: "", timing: t, device: deviceLabel(), build: BUILD }) }).catch(() => {});
  } catch { /* ignore */ }
}
let lastMsgAt = 0;
let loadStage = "";
let safeNext = isIOS() || (() => { try { return localStorage.getItem("wilson-puck-safe") === "1"; } catch { return false; } })(); // iPhones always start in low-memory mode; // low-memory session (after a failed try; remembered once it works)
let freshNext = false;    // next load clears a possibly half-saved model download first
let sessionRetried = false;

/* ---- why Puck didn't start, in plain words (kept across app restarts; shown in Settings → Voice test) ---- */
const FAIL_KEY = "wilson-puck-lastfail";
const STAGE_KEY = "wilson-puck-loading"; // set while a load is in progress; still set at the next start = the app was closed/killed mid-load
export type PuckFail = { at: number; stage: string; error: string; plain: string; build: string; device: string };
function deviceLabel(): string {
  const ua = navigator.userAgent || "";
  const ios = ua.match(/OS (\d+)[_.](\d+)/); const android = ua.match(/Android (\d+)/);
  const standalone = (navigator as any).standalone === true || matchMedia?.("(display-mode: standalone)").matches;
  const br = /CriOS|Chrome/.test(ua) ? "Chrome" : /FxiOS|Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "browser";
  const os = /iPhone|iPad|iPod/.test(ua) && ios ? `iPhone iOS ${ios[1]}.${ios[2]}` : android ? `Android ${android[1]}` : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "device";
  const mem = (navigator as any).deviceMemory; const cores = navigator.hardwareConcurrency;
  return `${os}, ${br}${standalone ? " (Home Screen app)" : ""}${mem ? `, ${mem} GB` : ""}${cores ? `, ${cores} cores` : ""}`;
}
function plainReason(stage: string, error: string): string {
  const e = error.toLowerCase();
  if (/app closed or reloaded/.test(e)) return stage === "downloading" ? "the app was closed before the voice download finished (keep Wilson open until it reaches 100%)" : "the phone closed or reloaded Wilson while the voice was starting (usually memory: close other apps and try again)";
  if (/undefined is not a function|is not a function|not iterable|iterator|asynciterator/.test(e)) return "this iPhone's Safari is missing a feature the voice engine used (fixed in the latest update; reopen Wilson)";
  if (/invalid regular expression|syntaxerror|unexpected token|invalid group/.test(e)) return "this phone's browser is too old for the on-device voice (update iOS / the browser)";
  if (/out of memory|memory|rangeerror|allocation|abort\(|oom/.test(e) || /killed|went silent|closed|reloaded/.test(e)) return "the phone ran out of memory while starting the voice (close other apps and try again)";
  if (/quota|storage/.test(e)) return "the phone is out of storage space for the voice download";
  if (/failed to fetch|network|load failed|fetch|404|403|cors|connection/.test(e)) return stage === "downloading" ? "the voice download was interrupted (try again on Wi‑Fi)" : "the voice engine file couldn't be downloaded (try again on Wi‑Fi)";
  if (/wasm|webassembly|compile|instantiate|no available backend/.test(e)) return "this phone couldn't start the voice engine (WebAssembly)";
  if (stage === "downloading") return "the voice download didn't finish";
  return "the on-device voice couldn't start";
}
function recordFail(stage: string, error: string) {
  const f: PuckFail = { at: Date.now(), stage: stage || "starting", error: error || "unknown", plain: plainReason(stage, error), build: BUILD, device: deviceLabel() };
  try { localStorage.setItem(FAIL_KEY, JSON.stringify(f)); localStorage.removeItem(STAGE_KEY); } catch { /* ignore */ }
  console.warn("[voice] Puck didn't start:", f.stage, f.error);
  reportFail(f);
}
export function getPuckFail(): PuckFail | null { try { const r = localStorage.getItem(FAIL_KEY); return r ? JSON.parse(r) as PuckFail : null; } catch { return null; } }
export function getPuckStage() { return loadStage; }
export function getPuckDevice() { try { return deviceLabel(); } catch { return ""; } }
/** Anonymous failure note to the Wilson worker (stage + error + phone type; no messages, no ids). */
function reportFail(f: PuckFail) {
  try {
    const url = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev") + "/voice/diag";
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: f.stage, error: f.error, device: f.device, build: f.build }) }).catch(() => {});
  } catch { /* ignore */ }
}
// A load that was still in progress when the app last closed = iOS likely killed the page for memory.
try {
  const prev = localStorage.getItem(STAGE_KEY);
  if (prev) { localStorage.removeItem(STAGE_KEY); recordFail(prev, "app closed or reloaded while the voice was loading"); safeNext = true; }
} catch { /* ignore */ }
let watchdog: ReturnType<typeof setInterval> | null = null;

function emit() { listeners.forEach((l) => l()); }
function setState(s: PuckState) { state = s; emit(); if (s === "ready" || s === "failed") readyWaiters.splice(0).forEach((w) => w(s === "ready")); }
export function getPuckState() { return state; }
export function getPuckProgress() { return progress; }
export function subscribePuck(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function puckIsSlow() { return rtf > 2; }

/* Crash guard, scoped to the build: a new deploy (which may fix the crash) gets fresh attempts. */
const BUILD = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
function guard(): number {
  try {
    const raw = localStorage.getItem(GUARD_KEY) || "";
    const g = raw.startsWith("{") ? JSON.parse(raw) as { n?: number; build?: string } : null;
    if (!g || g.build !== BUILD) return 0; // old-format value or a previous build: start over
    return Number(g.n) || 0;
  } catch { return 0; }
}
function setGuard(n: number) { try { localStorage.setItem(GUARD_KEY, JSON.stringify({ n, build: BUILD })); } catch { /* private mode */ } }

/** Can this device realistically run an 82M-parameter voice model? */
export function puckSupported(): boolean {
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined") return false;
  if (typeof indexedDB === "undefined" && typeof caches === "undefined") return false;
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem < 3) return false;
  const conn = (navigator as any).connection as { saveData?: boolean } | undefined;
  if (conn?.saveData) return false;
  if (guard() >= MAX_ATTEMPTS) return false; // it crashed / never worked here before (this build)
  return true;
}
/** Why Puck can't run here (for the small note / Voice test), or "" if it can. */
export function puckBlockedReason(): string {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return "this browser can't run the on-device voice";
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem < 3) return "this phone has too little memory for the on-device voice";
  if ((navigator as any).connection?.saveData) return "Data Saver is on";
  if (guard() >= MAX_ATTEMPTS) { const f = getPuckFail(); return `the on-device voice failed to load ${MAX_ATTEMPTS} times${f ? `: ${f.plain}` : ""}`; }
  return "";
}

function armWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!waiting.size) { clearInterval(watchdog!); watchdog = null; return; }
    const now = Date.now();
    let started: Wait | null = null;
    waiting.forEach((w) => { if (w.startedAt && !started) started = w; });
    const s = started as Wait | null;
    const over = s ? now - s.startedAt > synthBudgetMs(s.text) : now - lastMsgAt > START_GAP_MS;
    if (over) { console.warn("[voice] Puck worker stopped responding"); crashed("stopped responding while speaking (the phone may have stopped it, often for memory)"); }
  }, 2000);
}

/** Start downloading + loading Puck (idempotent). Call from a tap or an idle moment. */
export function ensurePuck(): void {
  if (state !== "off" || !puckSupported()) return;
  setState("loading");
  const safe = safeNext, fresh = freshNext; freshNext = false;
  loadStage = "starting";
  if (!wasReady) setGuard(guard() + 1); // a restart after a runtime crash loads from cache; don't count it
  const t0 = performance.now();
  lastMsgAt = Date.now();
  try {
    worker = new Worker(new URL("./puckWorker.ts", import.meta.url), { type: "module" });
  } catch (e) { recordFail("starting the voice worker", String((e as Error)?.message ?? e)); setState("failed"); return; }
  if (!wasReady) try { localStorage.setItem(STAGE_KEY, "starting"); } catch { /* ignore */ }
  worker.onerror = (e) => {
    // A module that can't even load (old browser, blocked file) gives an ErrorEvent with little detail.
    const msg = e.message || (loadStage === "starting" ? "the voice engine file couldn't load in this browser" : "worker error");
    try { e.preventDefault(); } catch { /* ignore */ }
    crashed(msg);
  };
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data;
    lastMsgAt = Date.now();
    if (m.type === "stage") { loadStage = m.stage; if (!wasReady && m.stage !== "ready") try { localStorage.setItem(STAGE_KEY, m.stage); } catch { /* ignore */ } emit(); }
    else if (m.type === "alive") { /* worker script loaded and parsed */ }
    else if (m.type === "progress") { progress = m.progress; if (m.bytes) puckStats.bytes = m.bytes; emit(); }
    else if (m.type === "ready") { puckStats.loadMs = Math.round(performance.now() - t0); progress = 100; wasReady = true; setGuard(0); loadStage = "ready"; puckStats.threads = m.threads || 1; puckStats.coi = !!m.coi; puckStats.safe = !!m.safe; try { localStorage.removeItem(STAGE_KEY); if (m.safe) localStorage.setItem("wilson-puck-safe", "1"); } catch { /* ignore */ } console.info(`[voice] Puck ready in ${(puckStats.loadMs / 1000).toFixed(1)}s`); setState("ready"); }
    else if (m.type === "failed") { if (m.stage) loadStage = m.stage; crashed(m.error || "failed to load"); }
    else if (m.type === "start") { const w = waiting.get(m.id); if (w) w.startedAt = Date.now(); }
    else if (m.type === "audio") {
      const w = waiting.get(m.id); if (!w) return;
      waiting.delete(m.id);
      if (m.wav && m.wav.byteLength > 1000) {
        if (m.secs >= 1.5) { const r = m.ms / 1000 / m.secs; rtf = rtf ? rtf * 0.6 + r * 0.4 : r; puckStats.rtf = Math.round(rtf * 100) / 100; }
        if (!puckStats.firstClipMs) puckStats.firstClipMs = m.ms;
        puckStats.clips = [...puckStats.clips, { chars: w.text.length, ms: m.ms, secs: Math.round(m.secs * 10) / 10, rtf: Math.round((m.ms / 1000 / Math.max(0.1, m.secs)) * 100) / 100, waitMs: (w.startedAt || Date.now()) - w.queuedAt }].slice(-8);
        console.info(`[voice] puck clip ${w.text.length} chars: ${m.ms} ms for ${m.secs.toFixed(1)} s (x${(m.ms / 1000 / m.secs).toFixed(2)})`);
        emit(); reportTiming();
        w.resolve(new Blob([m.wav], { type: "audio/wav" }));
      } else { if (m.error) console.warn("[voice] Puck clip failed:", m.error); w.resolve(null); }
    }
  };
  // Several cores when the page is cross-origin isolated; the retry after a failure always uses 1 (safest).
  const threads = (window as any).crossOriginIsolated && !sessionRetried ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - (isIOS() ? 0 : 1))) : 1;
  worker.postMessage({ type: "load", safe, fresh, threads });
  // A load that goes completely quiet (no download progress, no "ready") for 2 minutes is dead: e.g. iOS killed the worker.
  const me = worker;
  const lw = setInterval(() => {
    if (worker !== me || state !== "loading") { clearInterval(lw); return; }
    if (Date.now() - lastMsgAt > LOAD_SILENCE_MS) { clearInterval(lw); crashed("went silent (the phone may have stopped it, often for memory)"); }
  }, 5000);
}

/** The worker died, hung, or failed to load. After a successful load, restart it (model is cached). */
function crashed(why = "") {
  try { worker?.terminate(); } catch { /* ignore */ }
  worker = null;
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  waiting.forEach((w) => w.resolve(null)); waiting.clear();
  if (wasReady && restarts < MAX_RESTARTS) {
    restarts++; puckStats.restarts = restarts;
    console.warn(`[voice] restarting Puck (${restarts}/${MAX_RESTARTS})`);
    state = "off"; ensurePuck(); return;
  }
  if (!wasReady) {
    recordFail(loadStage, why);
    // First try failed: retry once right away in safe mode (plain WASM, single thread, low-memory session, fresh download).
    if (!sessionRetried && guard() < MAX_ATTEMPTS) { sessionRetried = true; safeNext = true; freshNext = !/memory|silent|closed|stopped|too old|syntax|regular expression|not a function|iterat/i.test(why); console.warn("[voice] retrying Puck in safe mode"); state = "off"; ensurePuck(); if ((state as PuckState) === "loading") return; }
  }
  setState("failed");
}

/**
 * Is the ~92 MB on-device Puck model already saved on this device (from an earlier download)?
 * Wilson only starts on-device Puck when it is; it never starts the big download on its own anymore
 * (Settings → "Download on-device Puck" does that on request).
 */
let onDisk: boolean | null = null;
let onDiskP: Promise<boolean> | null = null;
export function puckOnDiskKnown(): boolean | null { return onDisk; }
export function puckOnDisk(): Promise<boolean> {
  if (onDisk !== null) return Promise.resolve(onDisk);
  if (!onDiskP) onDiskP = (async () => {
    try {
      if (typeof caches === "undefined") return false;
      const c = await caches.open("transformers-cache");
      const keys = await c.keys();
      return keys.some((r) => r.url.includes("Kokoro-82M") && /\.onnx(\?|$)/.test(r.url));
    } catch { return false; }
  })().then((v) => { onDisk = v || state === "ready"; emit(); return onDisk; });
  return onDiskP;
}
subscribePuck(() => { if (state === "ready" && onDisk !== true) { onDisk = true; } });

/** Wait until Puck is ready (true) or failed / timed out (false). Starts loading it if it hasn't started. */
export function waitForPuck(timeoutMs: number): Promise<boolean> {
  if (state === "off") ensurePuck();
  if (state === "ready") return Promise.resolve(true);
  if (state === "failed" || state === "off") return Promise.resolve(false);
  return new Promise((res) => {
    const t = setTimeout(() => res(false), timeoutMs);
    readyWaiters.push((ok) => { clearTimeout(t); res(ok); });
  });
}

/** Synthesize one sentence with Puck. Resolves to a WAV blob, or null on any failure / cancel. */
export function puckSynth(text: string, speed: number, gen: number, voice = "am_michael"): Promise<Blob | null> {
  if (!worker || state !== "ready") return Promise.resolve(null);
  const id = nextId++;
  const allowed = new Set(["am_michael"]);
  const selectedVoice = allowed.has(voice) ? voice : "am_fenrir";
  return new Promise((resolve) => {
    if (!waiting.size) lastMsgAt = Date.now();
    waiting.set(id, { resolve, text, startedAt: 0, queuedAt: Date.now() });
    worker!.postMessage({ type: "speak", id, gen, text, speed, voice: selectedVoice });
    armWatchdog();
  });
}

/** Drop queued sentences from older replies (tap-to-interrupt). */
export function puckCancel(gen: number): void { worker?.postMessage({ type: "cancel", gen }); }

/** Settings → "Try Puck again": clears the failure counter and starts a fresh load (safe mode if a try failed before). */
export function retryPuck(): void {
  setGuard(0); sessionRetried = false;
  if (state === "loading" || state === "ready") return;
  if (getPuckFail()) safeNext = true;
  state = "off"; emit(); ensurePuck();
}
