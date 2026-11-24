import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseAndStripTags,
  stripTagsForDisplay,
  stripThoughtBlocks,
  isBlankAfterTags,
  EMPTY_REPLY_FALLBACK,
} from "../../src/memory/LocalMemory.ts";

test("parseAndStripTags removes a vibe tag and leaves the body", () => {
  const { clean, vibe } = parseAndStripTags("Hello there.\n\n[VIBE: neutral]");
  assert.equal(clean, "Hello there.");
  assert.equal(vibe, "neutral");
});

test("a vibe-only reply is blank after tags", () => {
  const raw = "[VIBE: neutral]";
  const { clean, vibe } = parseAndStripTags(raw);
  assert.equal(clean, "");
  assert.equal(vibe, "neutral");
  assert.equal(isBlankAfterTags(raw), true);
  assert.equal(isBlankAfterTags("   [VIBE: calm]   "), true);
  assert.equal(isBlankAfterTags("Still here [VIBE: calm]"), false);
});

test("thought blocks are stripped, including an unclosed one", () => {
  const withBlock = "<thought>internal scratch</thought>The sky is blue.\n[VIBE: calm]";
  const { clean, vibe } = parseAndStripTags(withBlock);
  assert.equal(clean, "The sky is blue.");
  assert.equal(vibe, "calm");
  assert.equal(isBlankAfterTags("<thought>only this</thought>\n[VIBE: tired]"), true);
  assert.equal(stripThoughtBlocks("<thought>secret</thought>Visible"), "Visible");
  assert.match(stripThoughtBlocks("<thought>still thinking"), /^\s*$/);
});

test("stripTagsForDisplay hides a half-streamed thought and vibe tag", () => {
  assert.equal(stripTagsForDisplay("Hello [VIBE: neu").trim(), "Hello");
  assert.equal(stripTagsForDisplay("Hello <thought>not yet done").trim(), "Hello");
  assert.equal(stripTagsForDisplay("<thought>hidden</thought>Hi there").trim(), "Hi there");
});

test("empty-reply fallback is short, warm, and not topic-specific", () => {
  assert.match(EMPTY_REPLY_FALLBACK, /didn't get an answer through/i);
  assert.match(EMPTY_REPLY_FALLBACK, /try(?:ing)? again/i);
  assert.equal(/bitcoin|btc|price/i.test(EMPTY_REPLY_FALLBACK), false);
  assert.ok(EMPTY_REPLY_FALLBACK.length < 120);
});

test("chat flow retries once on a blank body, then uses the shared fallback", () => {
  const src = readFileSync(resolve(import.meta.dirname, "../../src/App.tsx"), "utf8");
  assert.match(src, /let emptyRetry = false/);
  assert.match(src, /emptyRetry = true/);
  assert.match(src, /EMPTY_REPLY_FALLBACK/);
  assert.equal(src.includes("Eh, the void handed me silence"), false);
});
