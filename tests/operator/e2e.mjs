/**
 * Operator UI check in real Chrome at iPhone size, against a running build:
 *   npm run build && npx vite preview --host localhost --port 5173 &
 *   npm i --no-save playwright-core && node tests/operator/e2e.mjs
 * Uses the live wilson-proxy search + Jina reader, so it needs internet.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url);
const { chromium } = require("playwright-core");

const BASE = process.env.WILSON_BASE || "http://localhost:5173";
const OUT = process.env.SHOTS || "/workspace/shot/operator";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--font-render-hinting=none"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
const page = await ctx.newPage();
const result = {};
// Playwright's own screenshot waits on a frame that never comes with the app's canvas art in headless Chrome; CDP is instant.
const { writeFileSync } = await import("node:fs");
let cdp;
const shot = async (name) => { try { cdp ??= await page.context().newCDPSession(page); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, "base64")); } catch (e) { console.error("shot failed", name, e.message); } };
const run = async (goal) => {
  await page.fill(".wop .ask textarea", goal);
  await page.click(".wop .btn.go");
};
try {
  await page.goto(`${BASE}/?e2e_architect=1#operator`);
  await page.waitForTimeout(16000); // a first visit reloads once when the service worker takes over
  await page.waitForSelector(".wop .intro", { timeout: 30000 });
  await shot("1-start.png");

  // 1) Demo task end to end.
  const t0 = Date.now();
  await run("search for free AI grants for solo founders and list the top 3 with links");
  await page.waitForSelector(".wop .step", { timeout: 60000 });
  await page.waitForSelector(".wop .step .shot img", { timeout: 120000 }).catch(() => {});
  await shot("2-working.png");
  await page.waitForSelector(".wop .answer", { timeout: 300000 });
  result.demo = { seconds: Math.round((Date.now() - t0) / 1000), status: await page.$eval(".wop .answer", (n) => n.className), steps: await page.$$eval(".wop .step", (n) => n.map((x) => x.querySelector(".ttl")?.textContent + " — " + x.querySelector(".st")?.textContent)), links: await page.$$eval(".wop .answer .md a", (n) => n.map((a) => a.href)), answer: (await page.$eval(".wop .answer .md", (n) => n.innerText)).slice(0, 1500) };
  await shot("3-answer.png");
  await page.$eval(".wop .answer", (n) => n.scrollIntoView());
  await shot("3b-answer.png");

  // 2) Confirm gate: a log-out link must wait for a yes; say no.
  await page.click("text=New task");
  await run("Open https://example.com/account/logout and tell me what that page says.");
  await page.waitForSelector(".wop .sheet-wrap", { timeout: 120000 });
  result.gate = { asked: await page.$eval(".wop .sheet", (n) => n.innerText) };
  await shot("4-confirm.png");
  await page.click("text=No, don't");
  await page.waitForSelector(".wop .answer", { timeout: 180000 });
  result.gate.declinedStep = await page.$$eval(".wop .step.declined .ttl", (n) => n.map((x) => x.textContent));
  result.gate.answer = (await page.$eval(".wop .answer .md", (n) => n.innerText)).slice(0, 500);
  await shot("5-declined.png");

  // 3) Stop button.
  await page.click("text=New task");
  await run("Find three free note-taking apps that work on iPhone and compare them");
  await page.waitForSelector(".wop .btn.stop", { timeout: 10000 });
  await page.waitForTimeout(4000);
  await page.click(".wop .btn.stop");
  await page.waitForSelector(".wop .answer.stopped", { timeout: 20000 });
  result.stop = { ok: true, text: await page.$eval(".wop .answer", (n) => n.innerText.slice(0, 120)) };
  await shot("6-stopped.png");
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  await shot("error.png");
  console.log(JSON.stringify(result, null, 2));
  console.error("E2E FAILED:", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
