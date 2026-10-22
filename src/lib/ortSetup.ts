/**
 * One place that points onnxruntime-web (used by transformers.js for Puck, memory search and voice ID) at the
 * Wilson site's own copy of its plain WASM engine, single-threaded. Safest setup for iPhones:
 *  - no WebGPU/JSEP build (vite.config.ts aliases onnxruntime-web to its WASM-only build): ~11 MB instead of ~21 MB
 *  - threads only for Puck, and only when the service worker made the page cross-origin isolated (else 1)
 *  - same-origin files (no CDN), cached by the service worker across deploys
 */
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import ortMjs from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";

export function configureOrt(env: any, threads = 1): void {
  const w = env?.backends?.onnx?.wasm;
  if (!w) return;
  const base = typeof self !== "undefined" && (self as any).location ? (self as any).location.href : undefined;
  w.wasmPaths = { wasm: new URL(ortWasm, base).href, mjs: new URL(ortMjs, base).href };
  // Several cores only when the page is cross-origin isolated (service worker headers); otherwise 1.
  w.numThreads = (self as any).crossOriginIsolated ? Math.max(1, threads) : 1;
  w.proxy = false;
}

/** iPhone / iPad (incl. iPadOS that reports as Mac with touch). */
export function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  } catch { return false; }
}
