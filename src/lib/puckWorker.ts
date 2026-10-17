/// <reference lib="webworker" />
/**
 * Kokoro "Puck" voice, synthesized on the device inside a Web Worker (so the app never freezes).
 * Model: onnx-community/Kokoro-82M-v1.0-ONNX, q8 (~92 MB), WASM single thread (GitHub Pages can't
 * be cross-origin isolated). transformers.js keeps the model in the browser Cache API
 * ("transformers-cache") and kokoro-js keeps the voice in "kokoro-voices", so it downloads once.
 */
import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "am_puck";

type Job = { id: number; gen: number; text: string; speed: number };
let tts: KokoroTTS | null = null;
let loading: Promise<void> | null = null;
let latestGen = 0;
const queue: Job[] = [];
let busy = false;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

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

function load(): Promise<void> {
  if (!loading) loading = (async () => {
    const w = (env.backends.onnx as any)?.wasm;
    if (w) { w.numThreads = 1; w.proxy = false; }
    const files: Record<string, { loaded: number; total: number }> = {};
    const t0 = performance.now();
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p: any) => {
        if (p?.status === "progress" && p.file && p.total) {
          files[p.file] = { loaded: p.loaded ?? 0, total: p.total };
          const tot = Object.values(files).reduce((a, f) => a + f.total, 0);
          const ld = Object.values(files).reduce((a, f) => a + f.loaded, 0);
          post({ type: "progress", progress: tot ? Math.round((ld / tot) * 100) : 0, bytes: tot });
        }
      },
    });
    const loadMs = Math.round(performance.now() - t0);
    // Tiny warm-up so the first real sentence is fast and memory is proven before we say "ready".
    const t1 = performance.now();
    await tts.generate("Hi.", { voice: VOICE });
    post({ type: "ready", ms: loadMs, warmMs: Math.round(performance.now() - t1) });
  })().catch((e) => { loading = null; post({ type: "failed", error: String((e as Error)?.message ?? e).slice(0, 200) }); throw e; });
  return loading;
}

async function pump() {
  if (busy) return; busy = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      if (job.gen < latestGen) { post({ type: "audio", id: job.id, cancelled: true }); continue; }
      try {
        await load();
        post({ type: "start", id: job.id }); // the controller times each sentence from here, not from when it was queued
        const t0 = performance.now();
        const audio = await tts!.generate(job.text, { voice: VOICE, speed: job.speed });
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
  if (m?.type === "load") void load().catch(() => {});
  else if (m?.type === "speak") { queue.push(m as Job); void pump(); }
  else if (m?.type === "cancel") { latestGen = Math.max(latestGen, m.gen ?? 0); }
};
