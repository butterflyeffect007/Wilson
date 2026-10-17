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
        const t0 = performance.now();
        const audio = await tts!.generate(job.text, { voice: VOICE, speed: job.speed });
        const wav = audio.toWav() as ArrayBuffer;
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
