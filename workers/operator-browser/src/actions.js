/**
 * Page actions for Wilson's live browser. Plain Puppeteer API only, so the
 * same code runs on Cloudflare (@cloudflare/puppeteer) and in local tests
 * (puppeteer-core + Chrome).
 *
 * Defense in depth: the app already asks the user before submitting, buying,
 * sending, signing in or deleting. This file additionally refuses to type into
 * password / card / one-time-code fields, whatever the app asks.
 */

export const MAX_ELEMENTS = 60;

export function safeUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[::1\]|\[f[cd])/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

/** Number every visible link, button and field (data-wilson-n) and read the page. */
export async function snapshot(page, { screenshot = true } = {}) {
  const info = await page.evaluate((max) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none"; };
    const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 100);
    document.querySelectorAll("[data-wilson-n]").forEach((el) => el.removeAttribute("data-wilson-n"));
    const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [contenteditable=true]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (out.length >= max) break;
      if (!vis(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || "").toLowerCase();
      let kind = "button";
      if (tag === "a" || el.getAttribute("role") === "link") kind = "link";
      if ((tag === "input" && !["submit", "button", "reset", "image", "checkbox", "radio"].includes(type)) || tag === "textarea" || tag === "select" || el.isContentEditable) kind = "field";
      let text = "";
      if (kind === "field") {
        const id = el.id;
        const lab = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest("label");
        text = clean(el.getAttribute("aria-label") || (lab && lab.textContent) || el.getAttribute("placeholder") || el.getAttribute("name") || tag);
      } else {
        text = clean(el.innerText || el.getAttribute("aria-label") || el.getAttribute("value") || el.getAttribute("title") || (el.querySelector("img") && el.querySelector("img").alt) || "");
        if (!text) continue;
      }
      const n = out.length + 1;
      el.setAttribute("data-wilson-n", String(n));
      out.push({ n, kind, text, href: kind === "link" ? el.href : undefined, type: kind === "field" ? (type || tag) : undefined });
    }
    return { title: document.title, url: location.href, text: (document.body && document.body.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 8000), elements: out };
  }, MAX_ELEMENTS);
  let shot;
  if (screenshot) {
    try { shot = "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 55, encoding: "base64" })); } catch { /* optional */ }
  }
  return { ...info, screenshot: shot };
}

async function resolve(page, target) {
  const t = String(target ?? "").trim().replace(/^\[|\]$/g, "");
  if (!t) return null;
  if (/^\d+$/.test(t)) return page.$(`[data-wilson-n="${t}"]`);
  const handle = await page.evaluateHandle((needle) => {
    const low = needle.toLowerCase();
    const els = [...document.querySelectorAll("[data-wilson-n]")];
    const txt = (el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("value") || "").toLowerCase().trim();
    return els.find((el) => txt(el) === low) || els.find((el) => txt(el).includes(low)) || null;
  }, t);
  return handle.asElement ? handle.asElement() : null;
}

async function isSecret(el) {
  return el.evaluate((node) => {
    const type = (node.getAttribute("type") || "").toLowerCase();
    const ac = (node.getAttribute("autocomplete") || "").toLowerCase();
    const label = `${node.getAttribute("name") || ""} ${node.getAttribute("id") || ""} ${node.getAttribute("aria-label") || ""} ${node.getAttribute("placeholder") || ""}`;
    return type === "password" || /^cc-|one-time-code|current-password|new-password/.test(ac) || /\b(pass(word|code)?|pwd|cvv|cvc|card.?number|ssn|otp)\b/i.test(label);
  });
}

async function settle(page, ms = 1500) {
  try { await Promise.race([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: ms * 4 }), new Promise((r) => setTimeout(r, ms))]); } catch { /* no navigation */ }
}

/** Run actions in order; returns a note when something was refused or missing. */
export async function runActions(page, actions = []) {
  const notes = [];
  for (const a of actions.slice(0, 6)) {
    const type = String(a?.type || "");
    if (type === "goto") {
      const url = safeUrl(a.url);
      if (!url) { notes.push("That address isn't a public web page."); break; }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await settle(page, 800);
    } else if (type === "click") {
      const el = await resolve(page, a.target);
      if (!el) { notes.push(`Couldn't find "${String(a.target).slice(0, 60)}" on the page.`); break; }
      await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
      await el.click();
      await settle(page);
    } else if (type === "type") {
      const el = await resolve(page, a.target);
      if (!el) { notes.push(`Couldn't find the field "${String(a.target).slice(0, 60)}".`); break; }
      if (await isSecret(el)) { notes.push("Refused: that's a password, code or card field. Wilson never types those."); break; }
      await el.evaluate((n) => { n.focus(); if ("value" in n) { n.value = ""; n.dispatchEvent(new Event("input", { bubbles: true })); } });
      await el.type(String(a.text ?? "").slice(0, 2000), { delay: 8 });
    } else if (type === "submit") {
      const el = a.target ? await resolve(page, a.target) : null;
      if (a.target && !el) { notes.push(`Couldn't find "${String(a.target).slice(0, 60)}" to press.`); break; }
      if (el) await el.click(); else await page.keyboard.press("Enter");
      await settle(page, 2000);
    }
  }
  return notes.join(" ");
}
