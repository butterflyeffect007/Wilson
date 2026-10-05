#!/usr/bin/env node
/**
 * Fetches the authentic Wilson Orb fluid texture from the original wilsonaibro repo.
 * Run automatically via `npm run fetch-assets` or after clone.
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

async function main() {
  await mkdir(assetsDir, { recursive: true });

  if (await exists(target)) {
    console.log("✓ wilson-fluid.png already present");
    return;
  }

  console.log("Fetching authentic Wilson Orb fluid asset…");
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    console.error(`Failed to fetch asset: ${res.status} ${res.statusText}`);
    console.error("The Orb will fall back to a pure CSS presence.");
    process.exitCode = 1;
    return;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(target, buf);
  console.log(`✓ Saved ${target} (${(buf.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
