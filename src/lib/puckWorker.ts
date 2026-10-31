/// <reference lib="webworker" />
/**
 * Kokoro "Puck" voice, synthesized on the device inside a Web Worker (so the app never freezes).
 * Model: onnx-community/Kokoro-82M-v1.0-ONNX, q8 (~92 MB; the smallest build of this model), WASM single thread
 * (GitHub Pages can't be cross-origin isolated, so no SharedArrayBuffer/threads). transformers.js keeps the model in
 * the browser Cache API ("transformers-cache") and kokoro-js keeps the voice in "kokoro-voices", so it downloads once.
 *
 * Built against onnxruntime-web's plain WASM build (vite.config.ts alias; see ortSetup.ts):
 * half the engine size of the WebGPU-capable build and less memory, which matters on iPhones. The engine file is
 * served from the Wilson site itself (no CDN), and cached by the service worker across deploys.
 *
 * Every load reports which stage it is in, so a failure can be explained in plain words (Settings → Voice test).
 * "safe" mode (the retry after a failed load, remembered once it works): turns off ONNX's memory arena /
 * memory-pattern planning to lower peak memory. "fresh" clears a possibly half-saved model download first.
 */
import "./streamPolyfill"; // first: iPhone Safari needs it before the voice library loads
import { env, StyleTextToSpeech2Model, AutoTokenizer } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { configureOrt } from "./ortSetup";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "am_michael";

type Job = { id: number; gen: number; text: string; speed: number; voice?: string };
let tts: KokoroTTS | null = null;
let loading: Promise<void> | null = null;
let latestGen = 0;
let stage = "starting";
const queue: Job[] = [];
let busy = false;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);
const setStage = (s: string) => { stage = s; post({ type: "stage", stage: s }); };

/** 16-bit PCM WAV: half the size of the float WAV transformers.js makes, and plays everywhere (incl. older iOS). */
function wav16(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return buf;
}

/** Drop this model's saved files (a half-finished download can make every later load fail). The voice file stays. */
async function clearModelCache() {
  try {
    const c = await caches.open("transformers-cache");
    for (const req of await c.keys()) if (req.url.includes("Kokoro-82M")) await c.delete(req);
  } catch { /* no Cache API here */ }
}

let threads = 1;
function load(safe: boolean, fresh = false): Promise<void> {
  if (!loading) loading = (async () => {
    configureOrt(env, threads);
    const usedThreads = (env.backends.onnx as any)?.wasm?.numThreads ?? 1;
    if (fresh) { setStage("clearing old download"); await clearModelCache(); }
    const files: Record<string, { loaded: number; total: number }> = {};
    const t0 = performance.now();
    const progress_callback = (p: any) => {
      if (p?.status === "progress" && p.file && p.total) {
        if (stage !== "downloading") setStage("downloading");
        files[p.file] = { loaded: p.loaded ?? 0, total: p.total };
        const tot = Object.values(files).reduce((a, f) => a + f.total, 0);
        const ld = Object.values(files).reduce((a, f) => a + f.loaded, 0);
        post({ type: "progress", progress: tot ? Math.round((ld / tot) * 100) : 0, bytes: tot });
      } else if (p?.status === "done" && /onnx$/.test(p.file || "")) setStage("building the voice engine");
    };
    setStage("downloading");
    const session_options = safe ? { enableCpuMemArena: false, enableMemPattern: false } : undefined;
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm", progress_callback, ...(session_options ? { session_options } : {}) } as any),
      AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
    ]);
    tts = new KokoroTTS(model as any, tokenizer as any);
    const loadMs = Math.round(performance.now() - t0);
    // Tiny warm-up so the first real sentence is fast and memory is proven before we say "ready".
    setStage("first test sentence");
    const t1 = performance.now();
    await tts.generate("Hi.", { voice: VOICE });
    setStage("ready");
    post({ type: "ready", ms: loadMs, warmMs: Math.round(performance.now() - t1), safe, threads: usedThreads, coi: !!(self as any).crossOriginIsolated });
  })().catch((e) => {
    loading = null;
    const err = e as Error;
    post({ type: "failed", stage, error: `${err?.name ?? "Error"}: ${String(err?.message ?? e)}`.slice(0, 220) });
    throw e;
  });
  return loading;
}

let safeMode = false;
async function pump() {
  if (busy) return; busy = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      if (job.gen < latestGen) { post({ type: "audio", id: job.id, cancelled: true }); continue; }
      try {
        await load(safeMode);
        post({ type: "start", id: job.id }); // the controller times each sentence from here, not from when it was queued
        const t0 = performance.now();
        const allowedVoices = ["am_michael"] as const;
        const voice = allowedVoices.find((candidate) => candidate === job.voice) ?? VOICE;
        const audio = await tts!.generate(job.text, { voice, speed: job.speed });
        const wav = wav16(audio.audio as Float32Array, audio.sampling_rate);
        const secs = audio.audio.length / audio.sampling_rate;
        post({ type: "audio", id: job.id, wav, secs, ms: Math.round(performance.now() - t0) }, [wav]);
      } catch (e) {
        post({ type: "audio", id: job.id, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
  } finally { busy = false; }
}

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m?.type === "load") { safeMode = !!m.safe; threads = Number(m.threads) || 1; void load(safeMode, !!m.fresh).catch(() => {}); }
  else if (m?.type === "speak") { queue.push(m as Job); void pump(); }
  else if (m?.type === "cancel") { latestGen = Math.max(latestGen, m.gen ?? 0); }
};
// Uncaught errors / rejections inside the engine: report them with the stage instead of dying silently.
self.addEventListener("unhandledrejection", (e) => { const r = (e as PromiseRejectionEvent).reason; post({ type: "failed", stage, error: `unhandled: ${String(r?.message ?? r)}`.slice(0, 220) }); });
post({ type: "alive" });
