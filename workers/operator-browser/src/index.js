/**
 * wilson-operator-browser — a tiny Cloudflare Worker that gives Wilson's
 * Operator mode a real browser (Cloudflare Browser Run, Workers Free plan:
 * ~10 browser minutes/day, no card).
 *
 *   POST /act   { session?, actions:[{type:"goto",url}|{type:"click",target}|{type:"type",target,text}|{type:"submit",target?}], screenshot? }
 *   POST /close { session }
 *   GET  /health
 *
 * Auth: "Authorization: Bearer <OPERATOR_TOKEN>" (a Worker secret you choose).
 * CORS: only ALLOWED_ORIGINS (comma separated) may call it from a browser.
 * Nothing is stored: no logs of page content, no cookies kept after the
 * browser session ends (sessions close after ~2 minutes idle).
 */
import puppeteer from "@cloudflare/puppeteer";
import { runActions, snapshot } from "./actions.js";

const KEEP_ALIVE_MS = 120000;

function cors(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "https://butterflyeffect007.github.io").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ...(ok ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

const json = (o, status, h) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...h } });

function authorized(req, env) {
  const want = String(env.OPERATOR_TOKEN || "");
  const got = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (want.length < 16 || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function openBrowser(env, session) {
  if (session) {
    try { return { browser: await puppeteer.connect(env.BROWSER, session), reused: true }; } catch { /* expired: start fresh */ }
  }
  return { browser: await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS }), reused: false };
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true, configured: !!env.OPERATOR_TOKEN && !!env.BROWSER }, 200, h);
    if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405, h);
    if (!env.OPERATOR_TOKEN) return json({ ok: false, error: "OPERATOR_TOKEN secret isn't set on the Worker." }, 503, h);
    if (!authorized(req, env)) return json({ ok: false, error: "Wrong or missing Operator browser key." }, 401, h);
    let body = {};
    try { body = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400, h); }

    if (url.pathname === "/close") {
      if (body.session) { try { const b = await puppeteer.connect(env.BROWSER, String(body.session)); await b.close(); } catch { /* already gone */ } }
      return json({ ok: true }, 200, h);
    }
    if (url.pathname !== "/act") return json({ ok: false, error: "Not found" }, 404, h);

    let browser;
    try {
      const opened = await openBrowser(env, body.session ? String(body.session) : "");
      browser = opened.browser;
      const pages = await browser.pages();
      const page = pages[0] || (await browser.newPage());
      if (!opened.reused) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const note = await runActions(page, Array.isArray(body.actions) ? body.actions : []);
      const snap = await snapshot(page, { screenshot: body.screenshot !== false });
      const session = browser.sessionId();
      return json({ ok: true, session, note, ...snap }, 200, h);
    } catch (e) {
      const msg = String((e && e.message) || e);
      const status = /429|time limit/i.test(msg) ? 429 : 502;
      return json({ ok: false, error: status === 429 ? "The free browser time for today is used up (resets at midnight UTC)." : msg.slice(0, 300) }, status, h);
    } finally {
      try { if (browser) browser.disconnect(); } catch { /* ignore */ }
    }
  },
};
