import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

/** Fill public/sw.js with this build's version + precache list (app shell, fonts, icons, orb art). */
const BUILD_ID = Date.now().toString(36);

function swPrecache(): Plugin {
  let outDir = "dist";
  return {
    name: "wilson-sw-precache",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const sw = path.join(outDir, "sw.js");
      if (!fs.existsSync(sw)) return;
      const assets = fs.readdirSync(path.join(outDir, "assets"))
        .filter((f) => !/\.(wasm|woff|map)$/.test(f) && !/^transformers|^ort-|^puckWorker|vietnamese|latin-ext/.test(f))
        .map((f) => `assets/${f}`);
      const list = [...assets, "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "apple-touch-icon.png"];
      const version = BUILD_ID;
      fs.writeFileSync(path.join(outDir, "version.json"), JSON.stringify({ build: BUILD_ID, at: new Date().toISOString() }));
      fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(list)));
    },
  };
}

/** Use onnxruntime-web's plain WASM build everywhere (no WebGPU/JSEP): ~11 MB engine instead of ~21 MB, less memory on iPhones. Nothing in Wilson uses WebGPU. */
function ortWasmOnly(): Plugin {
  return {
    name: "wilson-ort-wasm-only",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (source === "onnxruntime-web") return this.resolve("onnxruntime-web/wasm", importer, { ...opts, skipSelf: true });
      return null;
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [ortWasmOnly(), react(), swPrecache()],
  worker: { format: "es", plugins: () => [ortWasmOnly()] },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __BUILD_AT__: JSON.stringify(new Date().toISOString()) },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
