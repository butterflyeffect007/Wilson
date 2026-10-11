/**
 * Captures mic audio as 16 kHz mono Float32 alongside Web Speech STT.
 * Samples stay in memory only and are dropped after analysis.
 */
const SR = 16000;
let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let node: ScriptProcessorNode | null = null;
let src: MediaStreamAudioSourceNode | null = null;
let chunks: Float32Array[] = [];
let inRate = SR;

export async function startCapture(): Promise<void> {
  await stopCapture();
  chunks = [];
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  try { ctx = new AudioContext({ sampleRate: SR }); } catch { ctx = new AudioContext(); }
  inRate = ctx.sampleRate;
  src = ctx.createMediaStreamSource(stream);
  node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node);
  node.connect(ctx.destination);
}

function resample(x: Float32Array, from: number): Float32Array {
  if (from === SR) return x;
  const ratio = from / SR, out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = x[Math.floor(i * ratio)];
  return out;
}

/** Stops capture and returns 16 kHz samples (or null if nothing captured). */
export async function stopCapture(): Promise<Float32Array | null> {
  node?.disconnect(); src?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  if (ctx) { try { await ctx.close(); } catch { /* ignore */ } }
  node = null; src = null; stream = null; ctx = null;
  if (!chunks.length) return null;
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  chunks = [];
  return resample(all, inRate);
}

/* ---------- speaker embedding (transformers.js, lazy) ---------- */
const SV_MODEL = "Xenova/wavlm-base-plus-sv";
let svPromise: Promise<{ processor: any; model: any }> | null = null;

function loadSV() {
  if (!svPromise) {
    svPromise = (async () => {
      const t = await import("@huggingface/transformers");
      const processor = await t.AutoProcessor.from_pretrained(SV_MODEL);
      const model = await t.AutoModelForXVector.from_pretrained(SV_MODEL, { dtype: "q8" } as any);
      return { processor, model };
    })().catch((e) => { svPromise = null; throw e; });
  }
  return svPromise;
}

export async function embedSpeaker(samples: Float32Array): Promise<number[]> {
  const { processor, model } = await loadSV();
  const inputs = await processor(samples.slice(0, SR * 8));
  const out = await model(inputs);
  return Array.from(out.embeddings.data as Float32Array);
}

export function warmSpeakerModel(): void { void loadSV().catch(() => {}); }
