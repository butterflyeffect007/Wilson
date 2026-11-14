/**
 * On-device "see" sidecar. SmolVLM-256M (~250 MB) via transformers.js.
 * Lazy-loaded, wasm-first so we do not fight the Puck ortWasmOnly path.
 * Never auto-downloads until she asks to look at a photo.
 */

const MODEL_ID = "HuggingFaceTB/SmolVLM-256M-Instruct";

export type SeeStatus = "idle" | "loading" | "ready" | "error";

let status: SeeStatus = "idle";
let lastError: string | null = null;
let pipePromise: Promise<SeePipe> | null = null;

type SeePipe = (input: { image: string; prompt?: string }) => Promise<string>;

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

async function loadPipe(): Promise<SeePipe> {
  status = "loading";
  lastError = null;
  try {
    const tf: any = await import("@huggingface/transformers");
    // wasm only — same constraint as Puck on iPhone; do not switch the runtime to webgpu here
    const pipe = await tf.pipeline("image-text-to-text", MODEL_ID, {
      device: "wasm",
      dtype: "q4",
    });
    const run: SeePipe = async ({ image, prompt }) => {
      const q = (prompt || "Describe this image clearly, in a few sentences.").trim();
      const out = await pipe(image, {
        text: `<|im_start|>User:<image>${q}<end_of_utterance>\nAssistant:`,
        max_new_tokens: 96,
      });
      if (typeof out === "string") return out;
      if (Array.isArray(out) && out[0]) {
        const row = out[0] as { generated_text?: unknown };
        const g = row.generated_text;
        if (typeof g === "string") return g;
        if (Array.isArray(g)) {
          const last = g[g.length - 1] as { content?: string; text?: string };
          return String(last?.content || last?.text || "");
        }
      }
      return JSON.stringify(out).slice(0, 800);
    };
    status = "ready";
    return run;
  } catch (e) {
    status = "error";
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

export function seeStatus(): { status: SeeStatus; error: string | null } {
  return { status, error: lastError };
}

export async function describeImage(blob: Blob, question?: string): Promise<{ text: string; error?: string }> {
  if (blob.size > 8 * 1024 * 1024) return { text: "", error: "That photo is too large (8 MB max)." };
  try {
    if (!pipePromise) pipePromise = loadPipe();
    const run = await pipePromise;
    const url = await toDataUrl(blob);
    const text = (await run({ image: url, prompt: question })).trim();
    if (!text) return { text: "", error: "Vision pack ran, but it didn't say anything." };
    return { text };
  } catch (e) {
    pipePromise = null;
    const msg = e instanceof Error ? e.message : String(e);
    return { text: "", error: `Vision pack failed: ${msg}` };
  }
}

export function fileFromCameraCapture(file: File | Blob): Blob {
  return file;
}
