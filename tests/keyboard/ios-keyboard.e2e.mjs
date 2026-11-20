/**
 * Headless WebKit + iPhone device metrics.
 * The real iOS keyboard cannot be opened here, so we patch visualViewport
 * before the app loads and shrink it the way a keyboard would.
 */
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";
import { existsSync } from "node:fs";

function playwrightHref() {
  if (process.env.PLAYWRIGHT_MODULE) return process.env.PLAYWRIGHT_MODULE;
  const candidates = [
    "/tmp/pw-webkit/node_modules/playwright",
    new URL("../../node_modules/playwright", import.meta.url).pathname,
  ];
  for (const c of candidates) {
    const entry = existsSync(c + "/index.js") ? c + "/index.js" : c;
    if (existsSync(entry)) return pathToFileURL(entry).href;
  }
  return "playwright";
}

const pw = await import(playwrightHref());
const { webkit, devices } = pw.default ?? pw;

const PORT = Number(process.env.PORT || 4179);
const BASE = `http://127.0.0.1:${PORT}/`;
const IPHONE = devices["iPhone 14"];
const KB = 336; // typical iPhone portrait keyboard height

function waitForServer(url, ms = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (Date.now() - start > ms) reject(new Error(`server not up: ${url}`));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function viewportInitScript() {
  return () => {
    const real = window.visualViewport;
    const listeners = { resize: new Set(), scroll: new Set() };
    let height = real?.height ?? window.innerHeight;
    let offsetTop = 0;
    const fake = {
      get width() { return window.innerWidth; },
      get height() { return height; },
      get offsetTop() { return offsetTop; },
      get offsetLeft() { return 0; },
      get pageTop() { return offsetTop; },
      get pageLeft() { return 0; },
      get scale() { return 1; },
      addEventListener(type, fn) {
        if (listeners[type]) listeners[type].add(fn);
      },
      removeEventListener(type, fn) {
        if (listeners[type]) listeners[type].delete(fn);
      },
      dispatchEvent(ev) {
        const set = listeners[ev.type];
        if (set) for (const fn of set) fn(ev);
        return true;
      },
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: fake });
    window.__simulateIosKeyboard = (kbHeight) => {
      const layout = window.innerHeight;
      height = Math.max(80, layout - kbHeight);
      offsetTop = 0;
      fake.dispatchEvent(new Event("resize"));
    };
    window.__dismissIosKeyboard = () => {
      height = window.innerHeight;
      offsetTop = 0;
      fake.dispatchEvent(new Event("resize"));
    };
  };
}

function boxWithinVisible(box, visibleHeight, pad = 1) {
  if (!box) return { ok: false, reason: "input has no box" };
  const top = box.y;
  const bottom = box.y + box.height;
  if (top < -pad) return { ok: false, reason: `input top ${top} is above the visible viewport` };
  if (bottom > visibleHeight + pad) {
    return { ok: false, reason: `input bottom ${bottom} is below visible height ${visibleHeight}` };
  }
  return { ok: true, top, bottom, visibleHeight };
}

async function main() {
  const preview = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: "/workspace/Wilson-keyboard-fix",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_BASE: "/" },
  });
  let out = "";
  preview.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
  preview.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
  try {
    await waitForServer(BASE);
    const browser = await webkit.launch({ headless: true });
    const context = await browser.newContext({
      ...IPHONE,
      isMobile: true,
      hasTouch: true,
      // Standalone PWA-ish: no browser chrome in device metrics
    });
    await context.addInitScript(viewportInitScript());
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });

    const input = page.locator('textarea[placeholder="Type a message..."]');
    await input.waitFor({ state: "visible", timeout: 30000 });

    // Before keyboard: input should already be in the layout viewport.
    const before = await input.boundingBox();
    const layoutH = IPHONE.viewport.height;
    const beforeCheck = boxWithinVisible(before, layoutH);
    if (!beforeCheck.ok) throw new Error(`before keyboard: ${beforeCheck.reason}`);

    await input.focus();
    await input.type("hello wilson", { delay: 10 });

    // Simulate the keyboard shrinking the visual viewport (layout height stays).
    const metrics = await page.evaluate((kb) => {
      window.__simulateIosKeyboard(kb);
      const vv = window.visualViewport;
      const cs = getComputedStyle(document.documentElement);
      const el = document.querySelector('textarea[placeholder="Type a message..."]');
      const r = el.getBoundingClientRect();
      return {
        innerHeight: window.innerHeight,
        vvHeight: vv.height,
        vvOffsetTop: vv.offsetTop,
        appHeight: cs.getPropertyValue("--app-height").trim(),
        kbInset: cs.getPropertyValue("--kb-inset").trim(),
        vvTop: cs.getPropertyValue("--vv-top").trim(),
        kbOpen: document.documentElement.classList.contains("kb-open"),
        inputTop: r.top,
        inputBottom: r.bottom,
        inputHeight: r.height,
        rootTop: document.getElementById("root")?.getBoundingClientRect().top ?? null,
        rootHeight: document.getElementById("root")?.getBoundingClientRect().height ?? null,
        scrollY: window.scrollY,
      };
    }, KB);

    const afterBox = await input.boundingBox();
    const visibleH = metrics.vvHeight;
    const afterCheck = boxWithinVisible(afterBox, visibleH);

    const report = { before, afterBox, metrics, afterCheck, layoutH, simulatedKb: KB };
    console.log(JSON.stringify(report, null, 2));

    if (metrics.scrollY !== 0) {
      throw new Error(`body scroll jumped to y=${metrics.scrollY}`);
    }
    if (metrics.appHeight !== `${metrics.vvHeight}px`) {
      throw new Error(`--app-height is ${metrics.appHeight}, expected ${metrics.vvHeight}px`);
    }
    if (metrics.kbInset !== `${KB}px`) {
      throw new Error(`--kb-inset is ${metrics.kbInset}, expected ${KB}px`);
    }
    if (!metrics.kbOpen) throw new Error("html.kb-open was not set");
    if (!afterCheck.ok) throw new Error(afterCheck.reason);

    // Community-room / accounts overlay: inject a sticky composer and confirm it stays visible.
    const overlay = await page.evaluate((kb) => {
      const wa = document.createElement("div");
      wa.className = "wa";
      wa.setAttribute("data-testid", "fake-wa");
      wa.innerHTML = `<div class="wrap wide" data-chat-root style="padding-bottom:0">
        <div style="height:800px">pad</div>
        <form class="composer"><div class="field"><input placeholder="Message the room…" value="hi" /></div>
        <button type="submit" class="sendb" aria-label="Send">➤</button></form></div>`;
      document.body.appendChild(wa);
      const field = wa.querySelector("input");
      field.focus();
      window.__simulateIosKeyboard(kb);
      const r = field.getBoundingClientRect();
      const waBox = wa.getBoundingClientRect();
      const vv = window.visualViewport;
      return {
        inputTop: r.top, inputBottom: r.bottom,
        waTop: waBox.top, waHeight: waBox.height, waBottom: waBox.bottom,
        vvHeight: vv.height,
      };
    }, KB);
    console.log("community overlay", JSON.stringify(overlay));
    if (overlay.waHeight > overlay.vvHeight + 1) {
      throw new Error(`accounts overlay height ${overlay.waHeight} exceeds visual viewport ${overlay.vvHeight}`);
    }
    if (overlay.inputBottom > overlay.vvHeight + 1 || overlay.inputTop < -1) {
      throw new Error(`community input ${overlay.inputTop}-${overlay.inputBottom} not in visual viewport ${overlay.vvHeight}`);
    }

    await browser.close();
    console.log("PASS: chat input stayed within the simulated visual viewport");
  } finally {
    try { preview.kill("SIGKILL"); } catch { /* already exited */ }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
