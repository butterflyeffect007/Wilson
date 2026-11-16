import test from "node:test";
import assert from "node:assert/strict";
import { parseAction, runOperator, type Brain, type Step } from "../../src/operator/loop";
import { gate } from "../../src/operator/safety";
import { linksFromMarkdown, type OperatorTools, type PageElement, type ToolOutcome } from "../../src/operator/tools";

// ---------- parsing ----------
test("parseAction: plain, fenced, top-level args, raw newlines, broken finish", () => {
  assert.deepEqual(parseAction('{"thought":"t","action":"search","args":{"q":"x"}}')?.args, { q: "x" });
  assert.equal(parseAction('```json\n{"action":"open","args":{"url":"https://a.b"}}\n```')?.action, "open");
  assert.deepEqual(parseAction('{"action":"search","q":"grants"}')?.args, { q: "grants" });
  assert.match(String(parseAction('{"action":"finish","answer":"line1\nline2"}')?.args.answer), /line1\nline2/);
  assert.match(String(parseAction('{"action":"finish","answer":"1. **[A](https://a.com)** "x"\n2. B"}')?.args.answer), /\[A\]\(https:\/\/a\.com\)/);
  assert.equal(parseAction("I think we should search"), null);
});

test("linksFromMarkdown numbers real links, skips images/anchors/dupes", () => {
  const els = linksFromMarkdown("[Home](https://x.org/) ![img](https://x.org/a.png) [Top](#top) [Grants 101](/learn) [Home](https://x.org/)", "https://x.org/page");
  assert.deepEqual(els.map((e) => [e.n, e.text, e.href]), [[1, "Home", "https://x.org/"], [2, "Grants 101", "https://x.org/learn"]]);
});

// ---------- safety gate ----------
test("gate: reading is free, consequential actions need a yes, secrets are blocked", () => {
  assert.equal(gate("search", { q: "x" }).kind, "allow");
  assert.equal(gate("open", { url: "https://grants.gov" }).kind, "allow");
  assert.equal(gate("open", { url: "file:///etc/passwd" }).kind, "block");
  assert.equal(gate("open", { url: "https://shop.example/checkout" }).kind, "confirm");
  assert.equal(gate("submit", { target: "Send" }, { live: true }).kind, "confirm");
  assert.equal(gate("submit", { target: "" }, { live: true, lastFieldLabel: "Search grants", lastFieldType: "search" }).kind, "allow");
  assert.equal(gate("submit", { target: "Buy now" }, { live: true, lastFieldLabel: "Search", lastFieldType: "search" }).kind, "confirm");
  assert.equal(gate("type", { field: "4", text: "x" }, { fieldLabel: "Password", fieldType: "password" }).kind, "block");
  assert.equal(gate("type", { field: "3", text: "x" }, { fieldLabel: "Card number" }).kind, "block");
  assert.equal(gate("type", { field: "1", text: "x" }, { fieldLabel: "Search grants", fieldType: "search" }).kind, "allow");
  for (const t of ["Buy now", "Place order", "Send message", "Sign in", "Delete account", "Subscribe"]) assert.equal(gate("click", { target: t }, { live: true, targetText: t }).kind, "confirm", t);
  assert.equal(gate("click", { target: "About us" }, { live: true, targetText: "About us", targetHref: "https://x.org/about" }).kind, "allow");
  // Without a live browser a click only opens the link, so an article titled "How to apply" is fine.
  assert.equal(gate("click", { target: "2" }, { live: false, targetText: "How to apply for grants", targetHref: "https://x.org/apply-guide" }).kind, "allow");
});

// ---------- loop with fakes ----------
function fakeBrain(replies: string[], seen: string[] = []): Brain {
  let i = 0;
  return { label: "fake", noTraining: true, complete: async (req) => { seen.push(req.userInput); return replies[Math.min(i++, replies.length - 1)]; } };
}
function fakeTools(calls: string[]): OperatorTools {
  const els: PageElement[] = [
    { n: 1, kind: "field", text: "Search grants", type: "search" },
    { n: 2, kind: "button", text: "Buy now" },
    { n: 3, kind: "field", text: "Password", type: "password" },
    { n: 4, kind: "link", text: "About", href: "https://x.org/about" },
  ];
  const ok = (summary: string): ToolOutcome => ({ ok: true, summary, observation: summary, sources: [{ title: summary, url: "https://x.org/" + calls.length }] });
  let last: { label: string; type: string } | null = null;
  return {
    live: true,
    elements: () => els,
    lastField: () => last,
    findElement: (t) => els.find((e) => String(e.n) === t || e.text === t) || null,
    search: async (q) => { calls.push(`search:${q}`); return ok(`results for ${q}`); },
    open: async (u) => { calls.push(`open:${u}`); return ok(`page ${u}`); },
    click: async (t) => { calls.push(`click:${t}`); return ok(`clicked ${t}`); },
    type: async (f, text) => { calls.push(`type:${f}:${text}`); const e = els.find((x) => String(x.n) === f); last = { label: e?.text || f, type: e?.type || "" }; return ok(`typed`); },
    submit: async (t) => { calls.push(`submit:${t}`); return ok(`submitted`); },
    snapshot: async () => ok("shot"),
    lookup: async (tool, q) => { calls.push(`lookup:${tool}:${q}`); return ok(`lookup ${tool}`); },
    close: async () => {},
  };
}
const J = (o: unknown) => JSON.stringify(o);

test("runOperator: plans, acts, and asks before buying; a 'no' means it never happens", async () => {
  const calls: string[] = [], steps: Step[] = [], asked: string[] = [];
  const res = await runOperator("buy the thing", {
    brain: fakeBrain([
      J({ action: "plan", args: { steps: ["search", "buy"] } }),
      J({ action: "search", args: { q: "thing" } }),
      J({ action: "click", args: { target: "2" } }),
      J({ action: "finish", args: { answer: "I didn't buy it because you said no." } }),
    ]),
    tools: fakeTools(calls),
    hooks: { signal: new AbortController().signal, onStep: (s) => steps.push(s), confirm: async (r) => { asked.push(r.reason); return false; } },
  });
  assert.equal(res.status, "done");
  assert.deepEqual(calls, ["search:thing"]);
  assert.equal(asked.length, 1);
  assert.ok(steps.some((s) => s.status === "declined" && s.kind === "click"));
  assert.ok(steps.some((s) => s.kind === "plan" && s.plan?.length === 2));
});

test("runOperator: a 'yes' lets the action run once", async () => {
  const calls: string[] = [];
  await runOperator("submit", {
    brain: fakeBrain([J({ action: "type", args: { field: "1", text: "hello" } }), J({ action: "submit", args: { target: "2" } }), J({ action: "finish", args: { answer: "done" } })]),
    tools: fakeTools(calls),
    hooks: { signal: new AbortController().signal, onStep: () => {}, confirm: async () => true },
  });
  assert.deepEqual(calls, ["type:1:hello", "submit:2"]);
});

test("runOperator: search boxes submit without asking", async () => {
  const calls: string[] = []; let asked = 0;
  await runOperator("search the site", {
    brain: fakeBrain([J({ action: "type", args: { field: "1", text: "AI" } }), J({ action: "submit", args: { target: "" } }), J({ action: "finish", args: { answer: "ok" } })]),
    tools: fakeTools(calls),
    hooks: { signal: new AbortController().signal, onStep: () => {}, confirm: async () => { asked++; return false; } },
  });
  assert.equal(asked, 0);
  assert.deepEqual(calls, ["type:1:AI", "submit:"]);
});

test("runOperator: never types a password, even if the model tries", async () => {
  const calls: string[] = [], steps: Step[] = [];
  await runOperator("log in", {
    brain: fakeBrain([J({ action: "type", args: { field: "3", text: "hunter2" } }), J({ action: "finish", args: { answer: "You'll need to sign in yourself." } })]),
    tools: fakeTools(calls),
    hooks: { signal: new AbortController().signal, onStep: (s) => steps.push(s), confirm: async () => true },
  });
  assert.deepEqual(calls, []);
  assert.ok(steps.some((s) => s.status === "blocked"));
});

test("runOperator: Stop halts immediately, including while waiting for an OK", async () => {
  const ctl = new AbortController(); const calls: string[] = [];
  const res = await runOperator("buy", {
    brain: fakeBrain([J({ action: "click", args: { target: "Buy now" } }), J({ action: "finish", args: { answer: "x" } })]),
    tools: fakeTools(calls),
    hooks: { signal: ctl.signal, onStep: () => {}, confirm: () => new Promise((r) => { setTimeout(() => { ctl.abort(); r(false); }, 10); }) },
  });
  assert.equal(res.status, "stopped");
  assert.deepEqual(calls, []);

  const ctl2 = new AbortController();
  const slow: Brain = { label: "slow", noTraining: true, complete: (_r, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) };
  setTimeout(() => ctl2.abort(), 20);
  const res2 = await runOperator("anything", { brain: slow, tools: fakeTools([]), hooks: { signal: ctl2.signal, onStep: () => {}, confirm: async () => false } });
  assert.equal(res2.status, "stopped");
});

test("runOperator: respects the step budget", async () => {
  const calls: string[] = [];
  const res = await runOperator("loop forever", {
    brain: fakeBrain([J({ action: "search", args: { q: "again" } })]),
    tools: fakeTools(calls), maxSteps: 4,
    hooks: { signal: new AbortController().signal, onStep: () => {}, confirm: async () => false },
  });
  assert.equal(calls.length, 4);
  assert.equal(res.status, "out_of_steps");
});
