/**
 * Controller for Wilson's on-device Kokoro "Puck" voice (see puckWorker.ts).
 * Loaded lazily (first tap / idle moment), never during app start. If anything goes wrong it just
 * reports "unavailable" and the caller uses the Aura-2 server voice instead. Never throws to callers.
 */
export type PuckState = "off" | "loading" | "ready" | "failed";

const GUARD_KEY = "wilson-puck-guard"; // crash guard: attempts that never reached a first spoken clip
const MAX_ATTEMPTS = 3;
const SYNTH_TIMEOUT_MS = 30000;

let state: PuckState = "off";
let progress = 0;
let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (b: Blob | null) => void; timer: ReturnType<typeof setTimeout> }>();
const readyWaiters: ((ok: boolean) => void)[] = [];
const listeners = new Set<() => void>();
/** Smoothed real-time factor (synth seconds / audio seconds). > 2 = this device is too slow to keep up. */
let rtf = 0;
export let puckStats = { loadMs: 0, firstClipMs: 0, bytes: 0 };

function emit() { listeners.forEach((l) => l()); }
function setState(s: PuckState) { state = s; emit(); if (s === "ready" || s === "failed") readyWaiters.splice(0).forEach((w) => w(s === "ready")); }
export function getPuckState() { return state; }
export function getPuckProgress() { return progress; }
export function subscribePuck(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function puckIsSlow() { return rtf > 2; }

function guard(): number { try { return Number(localStorage.getItem(GUARD_KEY) || "0") || 0; } catch { return 0; } }
function setGuard(n: number) { try { localStorage.setItem(GUARD_KEY, String(n)); } catch { /* private mode */ } }

/** Can this device realistically run an 82M-parameter voice model? */
export function puckSupported(): boolean {
  if (typeof window === "undefined" || typeof Worker === "undefined" || typeof WebAssembly === "undefined") return false;
  if (typeof indexedDB === "undefined" && typeof caches === "undefined") return false;
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem < 3) return false;
  const conn = (navigator as any).connection as { saveData?: boolean } | undefined;
  if (conn?.saveData) return false;
  if (guard() >= MAX_ATTEMPTS) return false; // it crashed / never worked here before
  return true;
}

/** Start downloading + loading Puck (idempotent). Call from a tap or an idle moment. */
export function ensurePuck(): void {
  if (state !== "off" || !puckSupported()) return;
  setState("loading");
  setGuard(guard() + 1);
  const t0 = performance.now();
  try {
    worker = new Worker(new URL("./puckWorker.ts", import.meta.url), { type: "module" });
  } catch (e) { console.warn("[voice] Puck worker failed to start", e); setState("failed"); return; }
  worker.onerror = (e) => { console.warn("[voice] Puck worker error", e.message); fail(); };
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data;
    if (m.type === "progress") { progress = m.progress; if (m.bytes) puckStats.bytes = m.bytes; emit(); }
    else if (m.type === "ready") { puckStats.loadMs = Math.round(performance.now() - t0); progress = 100; setGuard(0); console.info(`[voice] Puck ready in ${(puckStats.loadMs / 1000).toFixed(1)}s`); setState("ready"); }
    else if (m.type === "failed") { console.warn("[voice] Puck failed to load:", m.error); fail(); }
    else if (m.type === "audio") {
      const w = waiting.get(m.id); if (!w) return;
      waiting.delete(m.id); clearTimeout(w.timer);
      if (m.wav && m.wav.byteLength > 1000) {
        if (m.secs >= 1.5) { const r = m.ms / 1000 / m.secs; rtf = rtf ? rtf * 0.6 + r * 0.4 : r; }
        if (!puckStats.firstClipMs) puckStats.firstClipMs = m.ms;
        w.resolve(new Blob([m.wav], { type: "audio/wav" }));
      } else { if (m.error) console.warn("[voice] Puck clip failed:", m.error); w.resolve(null); }
    }
  };
  worker.postMessage({ type: "load" });
}

function fail() {
  try { worker?.terminate(); } catch { /* ignore */ }
  worker = null;
  waiting.forEach((w) => { clearTimeout(w.timer); w.resolve(null); }); waiting.clear();
  setState("failed");
}

/** Wait until Puck is ready (true) or failed / timed out (false). */
export function waitForPuck(timeoutMs: number): Promise<boolean> {
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
    const timer = setTimeout(() => { waiting.delete(id); resolve(null); }, SYNTH_TIMEOUT_MS);
    waiting.set(id, { resolve, timer });
    worker!.postMessage({ type: "speak", id, gen, text, speed });
  });
}

/** Drop queued sentences from older replies (tap-to-interrupt). */
export function puckCancel(gen: number): void { worker?.postMessage({ type: "cancel", gen }); }
