#!/usr/bin/env node
/**
 * Fetches the authentic Wilson Orb fluid texture from the original wilsonaibro repo.
 * Works on Node 16+ (no global fetch required).
 * Run via: npm run fetch-assets
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const assetsDir = join(root, "src", "assets");
const target = join(assetsDir, "wilson-fluid.png");
const sourceUrl =
  "https://raw.githubusercontent.com/jennifercox726-ux/wilsonaibro/main/src/assets/wilson-fluid.png";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // follow one redirect
          download(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  await mkdir(assetsDir, { recursive: true });

  if (await exists(target)) {
    console.log("✓ wilson-fluid.png already present");
    return;
  }

  console.log("Fetching authentic Wilson Orb fluid asset…");
  try {
    const buf = await download(sourceUrl);
    await writeFile(target, buf);
    console.log(`✓ Saved ${target} (${(buf.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error("Failed to fetch asset:", err.message || err);
    console.error("You can also download it manually with:");
    console.error(
      '  curl -fsSL -o src/assets/wilson-fluid.png "' + sourceUrl + '"',
    );
    console.error("The Orb will fall back to a pure CSS presence if the file is missing.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
