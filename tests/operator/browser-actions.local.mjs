/**
 * Local check of workers/operator-browser/src/actions.js against real Chrome.
 * Needs puppeteer-core and Chrome on this machine (not part of the app build):
 *   npm i --no-save puppeteer-core && CHROME=/usr/bin/google-chrome node tests/operator/browser-actions.local.mjs
 */
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runActions, snapshot, safeUrl } from "../../workers/operator-browser/src/actions.js";

const require = createRequire(process.env.PUPPETEER_FROM || import.meta.url);
const puppeteer = require("puppeteer-core");

const PAGE = `<!doctype html><title>Grant finder</title>
<h1>Grant finder</h1>
<form action="/results" method="get"><label for="q">Search grants</label><input id="q" name="q" type="search"><button>Search</button></form>
<form id="login" action="/login" method="post"><label>Email <input name="email"></label><label>Password <input name="pw" type="password"></label><button>Sign in</button></form>
<a href="/about">About us</a> <button onclick="document.title='BOUGHT'">Buy now</button>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  res.setHeader("Content-Type", "text/html");
  if (u.pathname === "/results") return res.end(`<title>Results</title><p>Results for ${u.searchParams.get("q")}</p><a href="/g1">Grant One</a>`);
  if (u.pathname === "/about") return res.end(`<title>About</title><p>About page</p>`);
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/`);
  let s = await snapshot(page);
  assert.equal(s.title, "Grant finder");
  assert.ok(s.screenshot?.startsWith("data:image/jpeg;base64,"), "screenshot");
  const search = s.elements.find((e) => e.kind === "field" && /search grants/i.test(e.text));
  const pw = s.elements.find((e) => e.kind === "field" && e.type === "password");
  assert.ok(search && pw, "fields numbered");
  console.log("elements:", s.elements.map((e) => `[${e.n}] ${e.kind}:${e.text}`).join(" | "));

  // Typing a password is refused by the worker itself.
  let note = await runActions(page, [{ type: "type", target: String(pw.n), text: "hunter2" }]);
  assert.match(note, /Refused/);
  assert.equal(await page.$eval('input[name=pw]', (n) => n.value), "");

  // Type into the search field and press Enter.
  note = await runActions(page, [{ type: "type", target: String(search.n), text: "solo founder AI" }, { type: "submit", target: "" }]);
  s = await snapshot(page, { screenshot: false });
  assert.equal(s.title, "Results");
  assert.match(s.text, /Results for solo founder AI/);

  // Click by visible text.
  await page.goto(`http://127.0.0.1:${port}/`); await snapshot(page, { screenshot: false });
  await runActions(page, [{ type: "click", target: "About us" }]);
  s = await snapshot(page, { screenshot: false });
  assert.equal(s.title, "About");

  // Private / non-http addresses are refused.
  assert.equal(safeUrl("http://127.0.0.1/"), null);
  assert.equal(safeUrl("file:///etc/passwd"), null);
  assert.ok(safeUrl("https://www.grants.gov/"));
  note = await runActions(page, [{ type: "goto", url: "http://localhost:1234" }]);
  assert.match(note, /isn't a public web page/);
  console.log("browser actions: all checks passed");
} finally {
  await browser.close(); server.close();
}
