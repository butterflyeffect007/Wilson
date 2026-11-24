import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeThreadTitle,
  shouldAutoTitle,
  pickMergedTitle,
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
  });
});
