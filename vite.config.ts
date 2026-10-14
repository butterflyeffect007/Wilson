import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

/** Fill public/sw.js with this build's version + precache list (app shell, fonts, icons, orb art). */
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
        .filter((f) => !/\.(wasm|woff|map)$/.test(f) && !/^transformers|^ort-|vietnamese|latin-ext/.test(f))
        .map((f) => `assets/${f}`);
      const list = [...assets, "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
      const version = Date.now().toString(36);
      fs.writeFileSync(sw, fs.readFileSync(sw, "utf8").replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(list)));
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), swPrecache()],
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
