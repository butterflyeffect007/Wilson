import assert from "node:assert/strict";
import test from "node:test";
import type { StoredThread, StoredMessage } from "../../src/memory/LocalMemory.ts";
import {
  applySummaryResult,
  chunkConversation,
  extractTitleLine,
  generateThreadSummary,
  normalizeSummary,
  pickMergedSummary,
  requestThreadSummary,
  shouldSummarize,
  transcriptOf,
  MAX_CHUNK_CHARS,
  MAX_CHUNKS,
} from "../../src/lib/threadSummary.ts";
import type { OpenRouterAdapter } from "../../src/intelligence/OpenRouterAdapter.ts";

function msg(role: StoredMessage["role"], content: string, i: number): StoredMessage {
  return { id: String(i), role, content, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString() };
}

function thread(partial: Partial<StoredThread> & { messages: StoredMessage[] }): StoredThread {
  return { id: "t1", title: "New Thread", createdAt: new Date(1_700_000_000_000).toISOString(), ...partial };
}

function adapter(replies: Array<string | Error>) {
  const calls: Array<{ systemContext?: string; userInput: string; metadata?: unknown }> = [];
  const impl = {
    generate: async (req: { systemContext?: string; userInput: string; metadata?: unknown }) => {
      calls.push(req);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("unexpected generate() call");
      return { text: next, model: "test", provider: "openrouter" };
    },
  };
  return { adapter: impl as unknown as OpenRouterAdapter, calls, replies };
}

test("normalizeSummary keeps bullets, drops fluff and a TITLE line", () => {
  const raw = `Here's a short recap:\n- Mortgage rates came up\n- Decided to wait a week\n- Next: check Friday's number\nTITLE: Mortgage Rate Watch`;
  assert.equal(
    normalizeSummary(raw),
    "- Mortgage rates came up\n- Decided to wait a week\n- Next: check Friday's number",
  );
  assert.equal(normalizeSummary(""), null);
  assert.equal(normalizeSummary("TITLE: Only A Title"), null);
  assert.equal(normalizeSummary("• First point\n* Second point"), "- First point\n- Second point");
});

test("extractTitleLine uses the same title normalizer", () => {
  assert.equal(extractTitleLine("- A point\nTITLE: mortgage rate watch!"), "Mortgage Rate Watch");
  assert.equal(extractTitleLine("no title here"), null);
  assert.equal(extractTitleLine("TITLE: x"), null);
});

test("shouldSummarize needs at least one user turn and one reply", () => {
  assert.equal(shouldSummarize(thread({ messages: [msg("assistant", "Hey", 0)] })), false);
  assert.equal(shouldSummarize(thread({ messages: [msg("assistant", "Hey", 0), msg("user", "Hi", 1)] })), true);
  assert.equal(
    shouldSummarize(thread({ messages: [msg("assistant", "Hey", 0), msg("user", "Hi", 1), msg("assistant", "Hello", 2)] })),
    true,
  );
});

test("chunkConversation splits by character budget and caps overflow to start + recent end", () => {
  const long = "word ".repeat(200);
  const messages = Array.from({ length: 30 }, (_, i) => msg(i % 2 ? "assistant" : "user", long, i));
  const chunks = chunkConversation(messages, 2500, 360, MAX_CHUNKS);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.length <= MAX_CHUNKS);
  assert.equal(chunks[0][0].id, "0");
  const last = chunks[chunks.length - 1];
  assert.equal(last[last.length - 1].id, "29");
  const tiny = chunkConversation([msg("user", "hi", 0), msg("assistant", "hey", 1)], MAX_CHUNK_CHARS);
  assert.equal(tiny.length, 1);
  assert.equal(tiny[0].length, 2);
});

test("transcriptOf labels speakers and trims long messages", () => {
  const t = transcriptOf([msg("user", "hello " + "x".repeat(500), 0), msg("assistant", "hi", 1)], 20);
  assert.match(t, /^USER: hello x+/m);
  assert.match(t, /^WILSON: hi$/m);
  assert.ok(!t.includes("x".repeat(40)));
});

test("applySummaryResult saves the recap and retitles unless the user locked the name", () => {
  const base = thread({
    messages: [msg("user", "Hi", 0), msg("assistant", "Hello", 1)],
    title: "Hi",
  });
  const unlocked = applySummaryResult(base, { summary: "- Hello there", title: "Friendly Hello" }, "2026-11-23T12:00:00.000Z");
  assert.equal(unlocked.summary, "- Hello there");
  assert.equal(unlocked.summaryAt, "2026-11-23T12:00:00.000Z");
  assert.equal(unlocked.title, "Friendly Hello");
  assert.equal(unlocked.autoTitled, true);
  assert.equal(unlocked.titleAtCount, 2);

  const locked = applySummaryResult(
    { ...base, title: "My Name", titleLocked: true },
    { summary: "- Hello there", title: "Friendly Hello" },
    "2026-11-23T12:00:00.000Z",
  );
  assert.equal(locked.title, "My Name");
  assert.equal(locked.titleLocked, true);
  assert.equal(locked.autoTitled, undefined);
  assert.equal(locked.summary, "- Hello there");
});

test("applySummaryResult keeps the old title when no TITLE was parsed", () => {
  const base = thread({ messages: [msg("user", "Hi", 0)], title: "Hi", autoTitled: true, titleAtCount: 1 });
  const next = applySummaryResult(base, { summary: "- Just a recap", title: null });
  assert.equal(next.title, "Hi");
  assert.equal(next.titleAtCount, 1);
  assert.equal(next.summary, "- Just a recap");
});

test("pickMergedSummary keeps the only recap, or the newer dated one", () => {
  const none = thread({ messages: [] });
  const older = thread({ messages: [], summary: "- Old", summaryAt: "2026-11-01T00:00:00.000Z" });
  const newer = thread({ messages: [], summary: "- New", summaryAt: "2026-11-20T00:00:00.000Z" });
  assert.deepEqual(pickMergedSummary(older, none), { summary: "- Old", summaryAt: older.summaryAt });
  assert.deepEqual(pickMergedSummary(none, newer), { summary: "- New", summaryAt: newer.summaryAt });
  assert.deepEqual(pickMergedSummary(older, newer), { summary: "- New", summaryAt: newer.summaryAt });
  assert.deepEqual(pickMergedSummary(none, none), {});
});

test("generateThreadSummary returns bullets and a title from one call", async () => {
  const { adapter: ad, calls } = adapter([
    "- Main points: Texas grid\n- Decision: wait on rates\n- Next: check Friday\nTITLE: Texas Grid Recap",
  ]);
  const t = thread({
    messages: [
      msg("assistant", "Hey", 0),
      msg("user", "How is the Texas grid?", 1),
      msg("assistant", "Peak was 54,118 MW.", 2),
    ],
  });
  const result = await generateThreadSummary(ad, t);
  assert.equal(result?.summary, "- Main points: Texas grid\n- Decision: wait on rates\n- Next: check Friday");
  assert.equal(result?.title, "Texas Grid Recap");
  assert.equal(calls.length, 1);
  assert.equal((calls[0].metadata as { task?: string }).task, "summary");
  assert.match(calls[0].userInput, /USER: How is the Texas grid\?/);
  assert.match(calls[0].userInput, /WILSON: Peak was 54,118 MW\./);
});

test("generateThreadSummary chunks long chats, then merges; a failed call returns null", async () => {
  const long = "word ".repeat(200);
  const messages = Array.from({ length: 12 }, (_, i) => msg(i % 2 ? "assistant" : "user", long, i));
  const t = thread({ messages });
  const ok = adapter([
    "- Early rates talk",
    "- Late next steps",
    "- Rates and the grid\n- Next: review Friday\nTITLE: Grid And Rates",
  ]);
  const tight = { maxChunkChars: 2500, perMsg: 360, maxChunks: 4 };
  const result = await generateThreadSummary(ok.adapter, t, tight);
  assert.ok(ok.calls.length >= 3, `expected chunk + merge calls, got ${ok.calls.length}`);
  assert.equal(result?.title, "Grid And Rates");
  assert.match(result?.summary || "", /Rates and the grid/);

  const fail = adapter([new Error("network down")]);
  assert.equal(await generateThreadSummary(fail.adapter, t, tight), null);

  const midFail = adapter(["- Early rates talk", new Error("timeout")]);
  assert.equal(await generateThreadSummary(midFail.adapter, thread({ messages }), tight), null);
});

test("requestThreadSummary applies a result and leaves state alone on failure", async () => {
  const t = thread({
    messages: [msg("user", "Hi", 0), msg("assistant", "Hello", 1)],
    title: "Hi",
    summary: "- Earlier recap",
  });
  let applied: { id: string; result: { summary: string; title: string | null } } | null = null;
  const ok = adapter(["- Hello there\nTITLE: Friendly Hello"]);
  const status = await requestThreadSummary(ok.adapter, t, (id, result) => { applied = { id, result }; });
  assert.equal(status, "ok");
  assert.equal(applied!.id, "t1");
  assert.equal(applied!.result.title, "Friendly Hello");

  applied = null;
  const bad = adapter([new Error("boom")]);
  const failed = await requestThreadSummary(bad.adapter, t, (id, result) => { applied = { id, result }; });
  assert.equal(failed, "fail");
  assert.equal(applied, null);
});

test("requestThreadSummary reports busy when a call is already in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const impl = {
    generate: async () => {
      await gate;
      return { text: "- Hello there\nTITLE: Friendly Hello", model: "test", provider: "openrouter" };
    },
  } as unknown as OpenRouterAdapter;
  const t = thread({ messages: [msg("user", "Hi", 0), msg("assistant", "Hello", 1)] });
  const first = requestThreadSummary(impl, t, () => {});
  const second = await requestThreadSummary(impl, t, () => {});
  assert.equal(second, "busy");
  release();
  assert.equal(await first, "ok");
});
