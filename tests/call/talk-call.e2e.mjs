/**
 * Headless check of the "Talk with Wilson" call loop. No live services: the brain (/v1/chat/completions),
 * voice (/tts/*) and every other outside request are mocked, and speech recognition is a fake that
 * "hears" scripted phrases. Run: node tests/call/talk-call.e2e.mjs  (vite dev on PORT, default 5321)
 * Env: CHROME=/usr/bin/google-chrome PW=playwright-core module path, SHOTS=/workspace/shot
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const pwPath = process.env.PW || "/workspace/shot/playwright-core";
const pw = await import(fs.existsSync(pwPath + "/index.js") ? pathToFileURL(pwPath + "/index.js").href : "playwright-core");
const { chromium } = pw.default ?? pw;
const BASE = `http://127.0.0.1:${process.env.PORT || 5321}/`;
const SHOTS = process.env.SHOTS || "/workspace/shot";
const MP3 = fs.readFileSync(process.env.MP3 || "/workspace/shot/andrew-sample.mp3");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const results = { checks: {} };
const check = (name, ok, detail) => { results.checks[name] = ok ? "PASS" : `FAIL ${detail ?? ""}`; };

function fakeRecognition() {
  // A fake webkitSpeechRecognition: window.__say(text) streams words as interim results, then a final, then ends (like iPhone).
  const live = new Set();
  window.__recStarts = 0; window.__recLog = [];
  class FakeRec {
    constructor() { this.lang = "en-US"; this.continuous = false; this.interimResults = true; this.onresult = null; this.onerror = null; this.onend = null; this.running = false; }
    start() { this.running = true; live.add(this); window.__recStarts++; window.__recLog.push("start"); }
    stop() { this.abort(); }
    abort() { if (!this.running) return; this.running = false; live.delete(this); window.__recLog.push("abort"); setTimeout(() => this.onend?.(), 10); }
  }
  window.webkitSpeechRecognition = FakeRec;
  window.SpeechRecognition = undefined;
  window.__listening = () => live.size;
  new MutationObserver(() => {
    const el = document.querySelector(".wl-call-status");
    if (el && /Thinking/.test(el.textContent || "") && !window.__thinkingAt) window.__thinkingAt = performance.now();
  }).observe(document, { subtree: true, childList: true, characterData: true });
  window.__say = async (text, gapMs = 120) => {
    const words = text.split(" ");
    const rec = [...live][0];
    if (!rec) return false;
    for (let i = 1; i <= words.length; i++) {
      if (!rec.running) return false;
      rec.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: words.slice(0, i).join(" ") }, isFinal: false, length: 1 }] });
      window.__lastWordAt = performance.now();
      await new Promise((r) => setTimeout(r, gapMs));
    }
    rec.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true, length: 1 }] });
    if (!rec.continuous) { rec.running = false; live.delete(rec); setTimeout(() => rec.onend?.(), 30); }
    return true;
  };
}

const REPLIES = [
  "Hey, it's good to hear you. I'm doing great tonight, just thinking about the stars. How's your evening going?",
  "Oh, that sounds like a lot. Tell me the part that's sitting heaviest on you, and we'll take it one piece at a time.",
  "Okay. Here's a story. Once upon a time there was a lighthouse that loved the fog. It kept talking all night long, telling the ships every secret of the sea, and it never ran out of things to say.",
];

async function setup(ua, label) {
  const b = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: ua, hasTouch: true, isMobile: ua === IPHONE_UA, permissions: ["microphone"] });
  const p = await ctx.newPage();
  const log = { chat: [], tts: [], blocked: [], errors: [] };
  p.on("pageerror", (e) => log.errors.push(String(e)));
  await p.addInitScript(fakeRecognition);
  await p.addInitScript(() => { try { localStorage.setItem("wilson_install_card_seen", "1"); localStorage.setItem("wilson-voice-lock", "edge-andrew"); localStorage.setItem("wilson_voiceprint_consent", "no"); } catch {} });
  let turn = 0;
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (r) => {
    const url = r.request().url();
    if (/\/v1\/chat\/completions/.test(url)) {
      const body = JSON.parse(r.request().postData() || "{}");
      const sys = (body.messages || []).filter((m) => m.role === "system").map((m) => String(m.content)).join("\n");
      const user = (body.messages || []).filter((m) => m.role === "user").map((m) => String(m.content)).pop();
      if (!body.stream) { // tool-planning call: no tools
        log.chat.push({ stream: false, user });
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }] }), headers: { "Access-Control-Allow-Origin": "*" } });
      }
      const reply = REPLIES[Math.min(turn++, REPLIES.length - 1)];
      log.chat.push({ stream: true, user, spokenCallNote: sys.includes("[Live voice call]"), turns: (body.messages || []).length });
      const sse = reply.split(/(?<= )/).map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`).join("") + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
      await new Promise((res) => setTimeout(res, 400));
      return r.fulfill({ status: 200, contentType: "text/event-stream", body: sse, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    if (/\/tts\/edge/.test(url)) {
      const body = JSON.parse(r.request().postData() || "{}");
      log.tts.push({ voice: body.voice, text: body.text });
      await new Promise((res) => setTimeout(res, 250));
      return r.fulfill({ status: 200, contentType: "audio/mpeg", body: MP3, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    log.blocked.push(url.slice(0, 120));
    if (/fonts|\.woff|\.png|\.jpg|\.webp/.test(url)) return r.continue();
    return r.fulfill({ status: 503, body: "offline in test", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await p.goto(BASE);
  await p.waitForTimeout(2000);
  const start = p.getByText("Start chatting", { exact: false }).first();
  if (await start.isVisible().catch(() => false)) { await start.click(); await p.waitForTimeout(1200); }
  return { b, ctx, p, log, label };
}

const phase = (p) => p.locator(".wl-call-status").innerText();
async function waitPhase(p, re, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const t = await phase(p).catch(() => ""); if (re.test(t)) return Date.now() - t0; await p.waitForTimeout(50); }
  throw new Error(`timeout waiting for ${re}; last="${await phase(p).catch(() => "?")}"`);
}

/* ---------------- iPhone run ---------------- */
for (const theme of ["dark", "light"]) {
  const { b, p, log } = await setup(IPHONE_UA, "iphone");
  if (theme === "dark") await p.evaluate(() => { document.documentElement.classList.add("dark"); });
  else await p.evaluate(() => { document.documentElement.classList.remove("dark"); });
  await p.waitForTimeout(400);
  const btn = p.locator("button.wl-talk-btn");
  check(`${theme}: Talk with Wilson button visible`, await btn.isVisible());
  const color = await btn.evaluate((e) => getComputedStyle(e).color);
  const font = await btn.evaluate((e) => getComputedStyle(e).fontFamily);
  check(`${theme}: button label not white and Lexend`, color !== "rgb(255, 255, 255)" && /Lexend/i.test(font), `${color} ${font}`);
  await p.screenshot({ path: `${SHOTS}/talk-button-home-${theme}.png` });

  if (theme === "light") {
    await btn.tap();
    await waitPhase(p, /Listening/);
    await p.screenshot({ path: `${SHOTS}/talk-call-listening-light.png` });
    await p.locator("button.wl-call-end").tap();
    await p.waitForTimeout(500);
    check("light: End call closes the call", (await p.locator(".wl-call").count()) === 0);
    await b.close();
    continue;
  }

  // Start the call
  await btn.tap();
  await waitPhase(p, /Listening/);
  check("call opens listening", true);
  check("dictation box untouched while calling", (await p.locator("textarea").inputValue()) === "");
  await p.evaluate(() => window.__say("hey Wilson how are you doing"));
  await p.waitForTimeout(400);
  check("live transcript shows her words", /how are you doing/.test(await p.locator(".wl-call-heard").innerText().catch(() => "")));
  await p.screenshot({ path: `${SHOTS}/talk-call-heard.png` });
  await waitPhase(p, /Thinking/, 4000);
  results.endOfTurnAfterLastWordMs = Math.round(await p.evaluate(() => window.__thinkingAt - window.__lastWordAt));
  check("end of turn ≈1.4 s after her last word", results.endOfTurnAfterLastWordMs >= 1200 && results.endOfTurnAfterLastWordMs <= 1700, results.endOfTurnAfterLastWordMs);
  await p.screenshot({ path: `${SHOTS}/talk-call-thinking.png` });
  await waitPhase(p, /Wilson is talking/);
  check("iPhone: mic is off while he talks (no audio-session fight)", (await p.evaluate(() => window.__listening())) === 0);
  await p.screenshot({ path: `${SHOTS}/talk-call-speaking.png` });
  await waitPhase(p, /Listening/, 30000);
  check("back to listening on its own after he finishes", true);

  // Turn 2: she trails off mid-thought ("and") → waits longer, then continues
  await p.evaluate(() => window.__say("today was kind of rough and"));
  await p.waitForTimeout(1700);
  check("waits through a mid-thought pause (trailing 'and')", /Listening/.test(await phase(p)));
  await p.evaluate(() => window.__say("work was just a lot"));
  await waitPhase(p, /Thinking/, 5000);
  await waitPhase(p, /Wilson is talking/);
  await waitPhase(p, /Listening/, 30000);

  // Turn 3: interrupt by tapping the orb mid-reply
  await p.evaluate(() => window.__say("tell me a long story"));
  await waitPhase(p, /Wilson is talking/);
  await p.waitForTimeout(500);
  await p.locator("button.wl-call-orb").tap();
  await waitPhase(p, /Listening/, 2000);
  await p.waitForTimeout(300);
  const stillPlaying = (await p.locator('button[aria-label="Stop Wilson\'s voice"]').count()) > 0;
  check("tap the orb while he talks stops his voice and listens", !stillPlaying);

  // History
  await p.locator("button.wl-call-end").tap();
  await p.waitForTimeout(800);
  check("End call closes the call", (await p.locator(".wl-call").count()) === 0);
  check("End call stops listening", (await p.evaluate(() => window.__listening())) === 0);
  const userBubbles = await p.locator(".msg-user").allInnerTexts();
  results.historyUser = userBubbles;
  results.sentTurns = log.chat.filter((c) => c.stream).map((c) => c.user);
  check("each turn landed in chat history", userBubbles.some((t) => /how are you doing/.test(t)) && userBubbles.some((t) => /rough and work was just a lot/.test(t)) && userBubbles.some((t) => /long story/.test(t)), JSON.stringify(userBubbles));
  const heard2 = results.sentTurns[1];
  check("mid-thought pause kept as one message", heard2 === "today was kind of rough and work was just a lot", heard2);
  check("brain asked for spoken-call replies", log.chat.filter((c) => c.stream).every((c) => c.spokenCallNote));
  const voices = [...new Set(log.tts.map((t) => t.voice))];
  results.ttsVoices = voices; results.ttsRequests = log.tts.length;
  check("one voice for every reply (Andrew)", voices.length === 1, JSON.stringify(voices));
  await p.screenshot({ path: `${SHOTS}/talk-after-call-history.png` });

  // After the call, typing mic is the same old dictation: does not auto-send
  await p.evaluate(() => { window.__chatCount = 0; });
  const before = log.chat.length;
  await p.locator('button[aria-label="Talk to type"]').tap().catch(() => {});
  await p.waitForTimeout(800);
  results.dictationListening = await p.evaluate(() => window.__listening());
  await p.evaluate(() => window.__say("this should stay in the box"));
  await p.waitForTimeout(3500);
  const box = await p.locator("textarea").inputValue();
  check("dictation mic still never auto-sends", log.chat.length === before && /stay in the box/.test(box), `sent=${log.chat.length - before} box="${box}"`);
  results.iphoneErrors = log.errors;
  results.outsideRequestsBlocked = [...new Set(log.blocked)].slice(0, 15);
  await b.close();
}

/* ---------------- desktop: voice barge-in ---------------- */
{
  const { b, p, log } = await setup("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", "desktop");
  await p.locator("button.wl-talk-btn").click();
  await waitPhase(p, /Listening/);
  await p.evaluate(() => window.__say("tell me something nice"));
  await waitPhase(p, /Wilson is talking/);
  await p.waitForTimeout(300);
  check("desktop: mic stays open while he talks (for barge-in)", (await p.evaluate(() => window.__listening())) === 1);
  // his own words through the speaker don't stop him
  await p.evaluate(() => window.__say("good to hear you"));
  await p.waitForTimeout(300);
  check("desktop: his echo does not interrupt", /Wilson is talking/.test(await phase(p)));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.__say("wait hold on a second"));
  await waitPhase(p, /Listening/, 3000);
  check("desktop: talking over him interrupts (barge-in)", true);
  await p.locator("button.wl-call-end").click();
  results.desktopErrors = log.errors;
  await b.close();
}

console.log(JSON.stringify(results, null, 1));
const failed = Object.entries(results.checks).filter(([, v]) => v !== "PASS");
process.exit(failed.length ? 1 : 0);
