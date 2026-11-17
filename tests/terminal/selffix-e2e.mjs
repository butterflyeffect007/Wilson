// Live-push UI flow against a built app (`npx vite build` first), with the worker mocked.
// Real end-to-end against GitHub is done separately; this checks the screens and state restore.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = process.env.WILSON_E2E_PORT || "4392";
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT = process.env.WILSON_SHOT_DIR || "/workspace/shot";
mkdirSync(SHOT, { recursive: true });

const FILE = "export function Footer() {\n  return (\n    <div className=\"footnote\">\n      Wilson + The Only One\n    </div>\n  );\n}\n";
const EDIT = "TITLE: Sparkle in the footer\nSUMMARY: Adds a sparkle after the footer text.\nFILE: src/components/Footer.tsx\n<<<<<<< SEARCH\n      Wilson + The Only One\n=======\n      Wilson + The Only One ✦\n>>>>>>> REPLACE\nDONE";
const state = { rec: null, approvedAt: 0, proposeBody: null, previewReady: false };

function sse(text) {
  const chunks = text.match(/[\s\S]{1,40}/g) || [];
  return chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("")
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
}

const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", PORT, "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
const result = { ok: false, steps: [], error: "" };
const step = (s) => { result.steps.push(s); console.log("✓", s); };
try {
  await new Promise((r, j) => { const t = setTimeout(() => j(new Error("preview timeout")), 30000); server.stdout.on("data", (d) => { if (/Local/.test(String(d))) { clearTimeout(t); r(); } }); });
  (await import("node:fs")).rmSync("/tmp/wilson-selffix-e2e-chrome", { recursive: true, force: true }); // fresh phone every run
  const ctx = await chromium.launchPersistentContext("/tmp/wilson-selffix-e2e-chrome", {
    executablePath: "/usr/bin/google-chrome", args: ["--font-render-hinting=none"], viewport: { width: 390, height: 844 }, serviceWorkers: "block",
  });
  const browser = ctx;
  await ctx.addInitScript(() => {
    localStorage.setItem("wilson_architect_key", "e2e-not-a-real-key");
    localStorage.setItem("wilson_is_admin", "1");
    localStorage.setItem("wilson_onboarded", "1");
  });
  await ctx.route(/wilson-proxy\.butterflyeffect007\.workers\.dev/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
    const p = u.pathname;
    if (p === "/admin/check") return json({ isAdmin: true });
    if (p === "/admin/selffix/list") return json({ pushes: state.rec ? [state.rec] : [{ id: "old-1", title: "Bigger Back button", status: "live", prNumber: 7, prUrl: "https://github.com/butterflyeffect007/Wilson/pull/7", createdAt: "2026-11-15T18:00:00Z", liveAt: "2026-11-15T18:05:00Z", files: [], diff: [] }] });
    if (p === "/admin/selffix/tree") return json({ branch: "main", paths: [{ path: "src/components/Footer.tsx", size: FILE.length }, { path: "src/App.tsx", size: 10 }] });
    if (p === "/admin/selffix/file") return json({ path: u.searchParams.get("path"), exists: true, content: FILE, sha: "blob-1", size: FILE.length });
    if (p === "/v1/chat/completions") {
      const body = JSON.parse(req.postData() || "{}");
      const sys = body.messages?.[0]?.content || "";
      const text = /ONLY JSON/.test(sys) ? '{"files":["src/components/Footer.tsx"]}' : EDIT;
      return route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "Access-Control-Allow-Origin": "*" }, body: sse(text) });
    }
    if (p === "/admin/selffix/propose") {
      state.proposeBody = JSON.parse(req.postData() || "{}");
      state.rec = { id: "sparkle-1", title: state.proposeBody.title, summary: state.proposeBody.summary, files: state.proposeBody.files.map((f) => ({ path: f.path, status: f.status })), diff: state.proposeBody.diff, prNumber: 321, prUrl: "https://github.com/butterflyeffect007/Wilson/pull/321", status: "review", createdAt: new Date().toISOString() };
      return json(state.rec);
    }
    if (p === "/admin/selffix/sparkle-1/approve") { state.rec = { ...state.rec, status: "live", liveAt: new Date().toISOString(), mergeSha: "m1" }; state.approvedAt = Date.now(); return json(state.rec); }
    if (p === "/admin/selffix/sparkle-1/status") {
      const publish = state.rec.status === "live" ? { state: Date.now() - state.approvedAt > 4000 ? "live" : "building" } : { state: "waiting" };
      const preview = state.rec.status !== "review" ? { state: "gone" } : state.previewReady ? { state: "ready", url: `${BASE}/__fake_preview/` } : { state: "building", url: `${BASE}/__fake_preview/` };
      const check = state.previewReady ? { state: "passed" } : { state: "running" };
      return json({ ...state.rec, check, preview, publish, pr: { state: state.rec.status === "live" ? "merged" : "open", url: state.rec.prUrl } });
    }
    return json({}, 404);
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const { writeFileSync } = await import("node:fs");
  const shot = async (name) => { const r = await cdp.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${SHOT}/${name}`, Buffer.from(r.data, "base64")); };
  page.on("pageerror", (e) => { result.error += "pageerror: " + e + "\n"; });
  await page.route(`${BASE}/__fake_preview/**`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body style='background:#120624;color:#fff;font:20px sans-serif;padding:40px'>Wilson + The Only One ✦ (preview build)</body></html>" }));
  await page.goto(`${BASE}/#terminal`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sf-card"][data-state="empty"]', { timeout: 20000 });
  step("Terminal opens in Fix mode with the empty change card");
  await shot("simple-1-empty.png");

  await page.fill('.wterm input[aria-label="Message Wilson"]', "Add a sparkle to the footer text");
  await page.click('.wterm button[aria-label="Send"]');
  await page.waitForSelector('[data-testid="sf-card"][data-state="review"]', { timeout: 20000 });
  const f = state.proposeBody.files[0];
  if (!f.content || !f.content.includes("✦") || f.content.split("\n").length !== FILE.split("\n").length || f.baseSha !== "blob-1") throw new Error("propose did not send full file content + baseSha");
  step("Wilson builds the change and sends it automatically (full file + base sha)");
  await page.waitForSelector('[data-testid="sf-preview"][data-preview="building"]', { timeout: 15000 });
  const bodyText = await page.locator('[data-testid="sf-card"]').innerText();
  if (/\b(PR|pull request|diff|merge|deploy|build check)\b/i.test(bodyText)) throw new Error("jargon on card: " + bodyText);
  step("Card shows Preparing preview…, plain words only");
  await shot("simple-2-waiting.png");
  state.previewReady = true;
  await page.waitForSelector('[data-testid="sf-preview"][data-preview="ready"]', { timeout: 20000 });
  await page.waitForSelector("text=Safety check passed.", { timeout: 5000 });
  step("Safety check passed + Preview it ready");
  await page.click("text=See the code changes");
  await page.waitForSelector(".sf-code .diff", { timeout: 5000 });
  await shot("simple-3-code.png");
  await page.click("text=See the code changes");
  await page.click('[data-testid="sf-preview"]');
  await page.waitForSelector('[data-testid="sf-preview-overlay"] iframe', { timeout: 5000 });
  await page.waitForTimeout(800);
  const inFrame = await page.frameLocator('[data-testid="sf-preview-overlay"] iframe').locator("body").innerText();
  if (!inFrame.includes("preview build")) throw new Error("preview iframe did not load");
  step("Preview opens full screen inside Wilson");
  await shot("simple-4-preview.png");
  await page.click('[data-testid="sf-preview-back"]');
  await page.waitForSelector('[data-testid="sf-preview-overlay"]', { state: "detached", timeout: 5000 });
  step("Back to Terminal returns to the card");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="sf-card"][data-state="review"]', { timeout: 20000 });
  step("Reopening restores the waiting change");

  await page.click('[data-testid="sf-approve"]');
  await page.waitForSelector("text=Approved — putting it live…", { timeout: 10000 });
  step("Approve shows Approved — putting it live…");
  await shot("simple-5-publishing.png");
  await page.waitForSelector("text=It's live!", { timeout: 30000 });
  step("Flips to It's live! once published");
  await shot("simple-6-live.png");
  await page.click('[data-testid="sf-done"]');
  await page.waitForSelector('[data-testid="sf-card"][data-state="empty"]', { timeout: 5000 });
  await page.click("text=Earlier changes");
  await page.waitForSelector(".sf-hrow", { timeout: 5000 });
  step("Done clears the card; Earlier changes lists history");
  await shot("simple-7-history.png");

  await page.click('[data-testid="mode-python"]');
  await page.waitForSelector('[data-testid="run-btn"]', { timeout: 5000 });
  step("Run Python on this phone link opens the editor + Run");
  await shot("simple-8-python.png");
  await browser.close();
  result.ok = !result.error;
} catch (err) {
  result.error += String(err && err.stack || err);
} finally {
  try { process.kill(-server.pid); } catch { /* ignore */ }
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
