/**
 * One place that points onnxruntime-web (used by transformers.js for Puck, memory search and voice ID) at the
 * Wilson site's own copy of its plain WASM engine, single-threaded. Safest setup for iPhones:
 *  - no WebGPU/JSEP build (vite.config.ts aliases onnxruntime-web to its WASM-only build): ~11 MB instead of ~21 MB
 *  - single thread: GitHub Pages can't be cross-origin isolated, so iOS has no SharedArrayBuffer for threads
 *  - same-origin files (no CDN), cached by the service worker across deploys
 */
import ortWasm from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import ortMjs from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";

export function configureOrt(env: any): void {
  const w = env?.backends?.onnx?.wasm;
  if (!w) return;
  const base = typeof self !== "undefined" && (self as any).location ? (self as any).location.href : undefined;
  w.wasmPaths = { wasm: new URL(ortWasm, base).href, mjs: new URL(ortMjs, base).href };
  w.numThreads = 1;
  w.proxy = false;
}

/** iPhone / iPad (incl. iPadOS that reports as Mac with touch). */
export function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  } catch { return false; }
}
