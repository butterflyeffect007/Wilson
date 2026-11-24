import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeThreadTitle,
  shouldAutoTitle,
  shouldRefreshTitle,
  pickMergedTitle,
  TITLE_REFRESH_EVERY,
  generateThreadTitle,
} from "../../src/lib/autoTitle.ts";
import type { StoredThread, StoredMessage } from "../../src/memory/LocalMemory.ts";

function msg(role: StoredMessage["role"], content: string, i: number): StoredMessage {
  return { id: String(i), role, content, timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString() };
}

function thread(partial: Partial<StoredThread> & { messages: StoredMessage[] }): StoredThread {
  return { id: "t1", title: "New Thread", createdAt: new Date(1_700_000_000_000).toISOString(), ...partial };
}

test("normalize strips quotes, emoji, and Title-Cases 2–6 words", () => {
  assert.equal(normalizeThreadTitle(`"gematria of my name."`), "Gematria Of My Name");
  assert.equal(normalizeThreadTitle("Title: voice fix ideas ✨"), "Voice Fix Ideas");
  assert.equal(normalizeThreadTitle("JustOne"), null);
  assert.equal(normalizeThreadTitle(""), null);
  assert.equal(normalizeThreadTitle("one two three four five six seven eight"), "One Two Three Four Five Six");
});

test("shouldAutoTitle waits for Wilson's second reply and respects flags", () => {
  const greeting = [msg("assistant", "Hey", 0)];
  const oneExchange = [...greeting, msg("user", "Hi", 1), msg("assistant", "Hello", 2)];
  const twoExchanges = [...oneExchange, msg("user", "Name meaning?", 3), msg("assistant", "Let's look", 4)];
  assert.equal(shouldAutoTitle(thread({ messages: oneExchange })), false);
  assert.equal(shouldAutoTitle(thread({ messages: twoExchanges })), true);
  assert.equal(shouldAutoTitle(thread({ messages: twoExchanges, autoTitled: true })), false);
  assert.equal(shouldAutoTitle(thread({ messages: twoExchanges, titleLocked: true })), false);
});

test("pickMergedTitle never overwrites a user-renamed title", () => {
  const local = thread({ title: "My Custom Name", titleLocked: true, messages: [] });
  const remote = thread({ title: "Gematria Of My Name", autoTitled: true, messages: [] });
  assert.deepEqual(pickMergedTitle(local, remote, remote), {
    title: "My Custom Name",
    titleLocked: true,
    autoTitled: undefined,
    titleAtCount: undefined,
  });
  assert.deepEqual(pickMergedTitle(local, remote, local).title, "My Custom Name");
});

test("pickMergedTitle prefers an auto title over a first-message stub", () => {
  const stub = thread({ title: "What does my name mean in...", messages: [] });
  const auto = thread({ title: "Gematria Of My Name", autoTitled: true, messages: [] });
  assert.deepEqual(pickMergedTitle(stub, auto, stub), {
    title: "Gematria Of My Name",
    titleLocked: false,
    autoTitled: true,
    titleAtCount: undefined,
  });
});

test("shouldRefreshTitle waits ~10 messages and respects the rename lock", () => {
  const msgs = Array.from({ length: 5 }, (_, i) => msg(i % 2 ? "assistant" : "user", "hi", i));
  const titled = thread({ messages: msgs, autoTitled: true, titleAtCount: 5 });
  assert.equal(shouldRefreshTitle(titled), false);
  const drifted = thread({
    messages: Array.from({ length: 5 + TITLE_REFRESH_EVERY }, (_, i) => msg(i % 2 ? "assistant" : "user", "hi", i)),
    autoTitled: true,
    titleAtCount: 5,
  });
  assert.equal(shouldRefreshTitle(drifted), true);
  assert.equal(shouldRefreshTitle({ ...drifted, titleLocked: true }), false);
  assert.equal(shouldRefreshTitle({ ...drifted, autoTitled: false }), false);
});

test("generateThreadTitle ignores a Gemini reply and returns null", async () => {
  const ad = {
    generate: async () => ({
      text: "Should Not Become Title",
      model: "gemini-3.5-flash-lite",
      provider: "openrouter",
      metadata: { wilsonModel: "gemini-3.5-flash-lite", wilsonRoute: "background" },
    }),
  } as any;
  const twoExchanges = [
    { id: "0", role: "assistant", content: "Hey", timestamp: new Date(1_700_000_000_000).toISOString() },
    { id: "1", role: "user", content: "Hi", timestamp: new Date(1_700_000_001_000).toISOString() },
    { id: "2", role: "assistant", content: "Hello", timestamp: new Date(1_700_000_002_000).toISOString() },
    { id: "3", role: "user", content: "Name meaning?", timestamp: new Date(1_700_000_003_000).toISOString() },
    { id: "4", role: "assistant", content: "Let's look", timestamp: new Date(1_700_000_004_000).toISOString() },
  ];
  assert.equal(await generateThreadTitle(ad, thread({ messages: twoExchanges as any })), null);
});

test("generateThreadTitle accepts a Groq private-brain reply", async () => {
  const ad = {
    generate: async () => ({
      text: "Gematria Of My Name",
      model: "groq/openai/gpt-oss-120b",
      provider: "groq",
      metadata: { wilsonModel: "groq/openai/gpt-oss-120b", wilsonRoute: "private" },
    }),
  } as any;
  const twoExchanges = [
    { id: "0", role: "assistant", content: "Hey", timestamp: new Date(1_700_000_000_000).toISOString() },
    { id: "1", role: "user", content: "Hi", timestamp: new Date(1_700_000_001_000).toISOString() },
    { id: "2", role: "assistant", content: "Hello", timestamp: new Date(1_700_000_002_000).toISOString() },
    { id: "3", role: "user", content: "Name meaning?", timestamp: new Date(1_700_000_003_000).toISOString() },
    { id: "4", role: "assistant", content: "Let's look", timestamp: new Date(1_700_000_004_000).toISOString() },
  ];
  assert.equal(await generateThreadTitle(ad, thread({ messages: twoExchanges as any })), "Gematria Of My Name");
});
