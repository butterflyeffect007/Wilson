/**
 * Controller for Wilson's on-device Kokoro "Puck" voice (see puckWorker.ts).
 * Loaded lazily (first tap / idle moment), never during app start. If anything goes wrong it just
 * reports "unavailable" and the caller uses the Aura-2 server voice instead. Never throws to callers.
 */
export type PuckState = "off" | "loading" | "ready" | "failed";

const GUARD_KEY = "wilson-puck-guard"; // crash guard: load attempts that never reached "ready" (per build)
const MAX_ATTEMPTS = 3;
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
type Wait = { resolve: (b: Blob | null) => void; text: string; startedAt: number };
const waiting = new Map<number, Wait>();
const readyWaiters: ((ok: boolean) => void)[] = [];
const listeners = new Set<() => void>();
/** Smoothed real-time factor (synth seconds / audio seconds). Informational only (shown in Voice test). */
let rtf = 0;
export let puckStats = { loadMs: 0, firstClipMs: 0, bytes: 0, rtf: 0, restarts: 0 };
let lastMsgAt = 0;
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
  if (guard() >= MAX_ATTEMPTS) return "the on-device voice failed to load 3 times";
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
    if (over) { console.warn("[voice] Puck worker stopped responding"); crashed(); }
  }, 2000);
}

/** Start downloading + loading Puck (idempotent). Call from a tap or an idle moment. */
export function ensurePuck(): void {
  if (state !== "off" || !puckSupported()) return;
  setState("loading");
  if (!wasReady) setGuard(guard() + 1); // a restart after a runtime crash loads from cache; don't count it
  const t0 = performance.now();
  lastMsgAt = Date.now();
  try {
    worker = new Worker(new URL("./puckWorker.ts", import.meta.url), { type: "module" });
  } catch (e) { console.warn("[voice] Puck worker failed to start", e); setState("failed"); return; }
  worker.onerror = (e) => { console.warn("[voice] Puck worker error", e.message); crashed(); };
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data;
    lastMsgAt = Date.now();
    if (m.type === "progress") { progress = m.progress; if (m.bytes) puckStats.bytes = m.bytes; emit(); }
    else if (m.type === "ready") { puckStats.loadMs = Math.round(performance.now() - t0); progress = 100; wasReady = true; setGuard(0); console.info(`[voice] Puck ready in ${(puckStats.loadMs / 1000).toFixed(1)}s`); setState("ready"); }
    else if (m.type === "failed") { console.warn("[voice] Puck failed to load:", m.error); crashed(); }
    else if (m.type === "start") { const w = waiting.get(m.id); if (w) w.startedAt = Date.now(); }
    else if (m.type === "audio") {
      const w = waiting.get(m.id); if (!w) return;
      waiting.delete(m.id);
      if (m.wav && m.wav.byteLength > 1000) {
        if (m.secs >= 1.5) { const r = m.ms / 1000 / m.secs; rtf = rtf ? rtf * 0.6 + r * 0.4 : r; puckStats.rtf = Math.round(rtf * 100) / 100; }
        if (!puckStats.firstClipMs) puckStats.firstClipMs = m.ms;
        w.resolve(new Blob([m.wav], { type: "audio/wav" }));
      } else { if (m.error) console.warn("[voice] Puck clip failed:", m.error); w.resolve(null); }
    }
  };
  worker.postMessage({ type: "load" });
  // A load that goes completely quiet (no download progress, no "ready") for 2 minutes is dead: e.g. iOS killed the worker.
  const me = worker;
  const lw = setInterval(() => {
    if (worker !== me || state !== "loading") { clearInterval(lw); return; }
    if (Date.now() - lastMsgAt > LOAD_SILENCE_MS) { clearInterval(lw); console.warn("[voice] Puck load went silent"); crashed(); }
  }, 5000);
}

/** The worker died, hung, or failed to load. After a successful load, restart it (model is cached). */
function crashed() {
  try { worker?.terminate(); } catch { /* ignore */ }
  worker = null;
  if (watchdog) { clearInterval(watchdog); watchdog = null; }
  waiting.forEach((w) => w.resolve(null)); waiting.clear();
  if (wasReady && restarts < MAX_RESTARTS) {
    restarts++; puckStats.restarts = restarts;
    console.warn(`[voice] restarting Puck (${restarts}/${MAX_RESTARTS})`);
    state = "off"; ensurePuck(); return;
  }
  setState("failed");
}

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
export function puckSynth(text: string, speed: number, gen: number): Promise<Blob | null> {
  if (!worker || state !== "ready") return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    if (!waiting.size) lastMsgAt = Date.now();
    waiting.set(id, { resolve, text, startedAt: 0 });
    worker!.postMessage({ type: "speak", id, gen, text, speed });
    armWatchdog();
  });
}

/** Drop queued sentences from older replies (tap-to-interrupt). */
export function puckCancel(gen: number): void { worker?.postMessage({ type: "cancel", gen }); }
