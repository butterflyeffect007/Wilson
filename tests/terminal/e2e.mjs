import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = process.env.WILSON_E2E_PORT || "4177";
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync("/workspace/shot", { recursive: true });

function waitForOutput(proc, pattern, timeoutMs) {
  return new Promise((resolveWait, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("server start timeout\n" + buf)), timeoutMs);
    const on = (chunk) => {
      buf += chunk.toString();
      if (pattern.test(buf)) { clearTimeout(t); proc.stdout.off("data", on); proc.stderr.off("data", on); resolveWait(buf); }
    };
    proc.stdout.on("data", on);
    proc.stderr.on("data", on);
  });
}

const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", PORT, "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, BROWSER: "none" },
  detached: true,
});
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

const result = { ok: false, ready: false, ran: false, figure: false, output: "", error: "" };

try {
  await waitForOutput(server, /Local:|127\.0\.0\.1/, 30_000);
  const browser = await chromium.launchPersistentContext("/tmp/wilson-e2e-chrome", {
    executablePath: "/usr/bin/google-chrome",
    args: ["--font-render-hinting=none"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = browser.pages()[0] || await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  page.on("pageerror", (err) => { result.error += String(err) + "\n"; });
  await page.goto(`${BASE}/?e2e_architect=1#terminal`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".wterm", { timeout: 15_000 });

  const ready = page.locator('[data-pyodide="ready"]');
  await ready.waitFor({ timeout: 180_000 });
  result.ready = true;

  await page.waitForTimeout(400);
  await page.screenshot({ path: "/workspace/shot/terminal-real.png", type: "png", animations: "disabled" });
  await page.screenshot({ path: "/workspace/shot/terminal-v2.png", type: "png", animations: "disabled" });

  await page.locator('[data-testid="run-btn"]').click();
  await page.waitForSelector('[data-run="ok"], [data-run="error"]', { timeout: 120_000 });
  const runState = await page.getAttribute(".wterm", "data-run");
  result.ran = runState === "ok";
  result.output = (await page.locator('[data-testid="terminal-output"]').innerText()).slice(0, 2000);
  result.figure = await page.locator("img[data-figure]").count().then((n) => n > 0);

  await page.evaluate(() => {
    const sc = document.getElementById("wterm-scroll");
    const card = document.getElementById("output-card");
    if (!sc || !card) return;
    const r = card.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    sc.scrollTop += (r.top - s.top - 8);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: "/workspace/shot/terminal-real-output.png", type: "png", animations: "disabled" });

  if (!result.ran) result.error += `run state=${runState}\n`;
  if (!result.figure) result.error += "no matplotlib figure\n";
  if (!/resonance/i.test(result.output)) result.error += "output missing 'resonance'\n";
  result.ok = result.ready && result.ran && result.figure && /resonance/i.test(result.output);

  await browser.close();
} catch (err) {
  result.error += String(err && err.stack || err);
} finally {
  try { if (server.pid) process.kill(-server.pid, "SIGKILL"); } catch { /* ignore */ }
}

writeFileSync("/workspace/Wilson-lab/tests/terminal/e2e-result.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
