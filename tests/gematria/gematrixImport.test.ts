/**
 * Contract checks for automatic gematrix.org phrase import.
 * Run with: node --experimental-strip-types --test src/gematria/gematrixImport.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canImportWord,
  fetchGematrixMatches,
  mergeImportedPhrases,
  nextImportDelay,
  normalizeImportWord,
} from "../../src/gematria/gematrixImport.ts";
import { calculateCipher, findPhraseMatches, type PhraseEntry } from "../../src/gematria/gematria.ts";

test("normalize and reject empty or oversized words", () => {
  assert.equal(normalizeImportWord("  butterfly   effect  "), "butterfly effect");
  assert.equal(canImportWord(""), false);
  assert.equal(canImportWord("   "), false);
  assert.equal(canImportWord("butterfly"), true);
  assert.equal(canImportWord("x".repeat(201)), false);
  assert.equal(canImportWord("x".repeat(200)), true);
});

test("merge adds new gematrix phrases and skips duplicates", () => {
  const library: PhraseEntry[] = [
    { id: "starter-wilson", phrase: "WILSON", category: "Starter", source: "Built-in example" },
    { id: "mine", phrase: "yellow", category: "My phrases", source: "Added on this device" },
  ];
  const { next, added } = mergeImportedPhrases(
    library,
    ["yellow", "YELLOW", "  reverse  ", "leviathan", ""],
    () => "id-1",
  );
  assert.equal(added, 2);
  assert.equal(next[0].phrase, "reverse");
  assert.equal(next[0].source, "Imported from gematrix.org");
  assert.equal(next[0].category, "gematrix.org");
  assert.equal(next[1].phrase, "leviathan");
  assert.equal(next.length, 4);
});

test("merged phrases appear as Simple and English matches for wilson", () => {
  const found = ["yellow", "reverse", "leviathan", "numbers", "the dragon"];
  const { next } = mergeImportedPhrases([], found, () => "x");
  const simple = findPhraseMatches("wilson", next, "english-ordinal", { excludeExactText: true });
  const english = findPhraseMatches("wilson", next, "english-gematria", { excludeExactText: true });
  assert.equal(calculateCipher("wilson", "english-ordinal").total, 92);
  assert.equal(calculateCipher("wilson", "english-gematria").total, 552);
  assert.deepEqual(simple.map((m) => m.phrase), found);
  assert.deepEqual(english.map((m) => m.phrase), found);
  assert.ok(simple.every((m) => m.total === 92));
  assert.ok(english.every((m) => m.total === 552));
});

test("fetchGematrixMatches reads phrase strings and ignores junk", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      word: "love",
      source: "https://www.gematrix.org/?word=love",
      phrases: [
        { phrase: "oracle", values: { jewish: 775, english: 324, simple: 54 }, matches: ["english", "simple"] },
        { phrase: "sun", values: { jewish: 775, english: 324, simple: 54 }, matches: ["english", "simple"] },
        { phrase: "sun" },
        { phrase: "   " },
        { phrase: 12 },
        {},
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const phrases = await fetchGematrixMatches("  love  ", undefined, "https://example.test/gematrix");
    assert.deepEqual(phrases, ["oracle", "sun"]);
    assert.equal(calls[0], "https://example.test/gematrix?word=love");
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchGematrixMatches throws a generic failure on a bad response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "upstream down" }), { status: 502 })) as typeof fetch;
  try {
    await assert.rejects(() => fetchGematrixMatches("love", undefined, "https://example.test/gematrix"), /upstream down|Could not import/);
  } finally {
    globalThis.fetch = original;
  }
});

test("polite delay waits for debounce and a minimum interval after a network fetch", () => {
  assert.equal(nextImportDelay(0, 1000, 550, 300), 550);
  assert.equal(nextImportDelay(1000, 1100, 550, 300), 550);
  assert.equal(nextImportDelay(1000, 1050, 100, 300), 250);
  assert.equal(nextImportDelay(1000, 1400, 100, 300), 100);
});
