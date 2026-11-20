import test from "node:test";
import assert from "node:assert/strict";
import type { OmniCaps } from "../../src/omni/caps.ts";
import {
  autoPickTier,
  calmTierError,
  canStartTier,
  isPhoneLike,
  isSoftTierNote,
  skipTierMessage,
} from "../../src/omni/tiers.ts";

const iphoneWebgpu: OmniCaps = {
  webgpu: true,
  shaderF16: false,
  deviceMemoryGB: null,
  mobile: true,
  ios: true,
  android: false,
  ua: "iPhone",
  error: null,
};

const desktopWebgpu: OmniCaps = {
  webgpu: true,
  shaderF16: true,
  deviceMemoryGB: 16,
  mobile: false,
  ios: false,
  android: false,
  ua: "Macintosh",
  error: null,
};

const iphoneNoGpu: OmniCaps = { ...iphoneWebgpu, webgpu: false };

test("iPhone is phone-like even when memory is hidden", () => {
  assert.equal(isPhoneLike(iphoneWebgpu), true);
  assert.equal(isPhoneLike(desktopWebgpu), false);
});

test("Gemma 4 E2B cannot start on an iPhone, even with WebGPU", () => {
  assert.equal(canStartTier("e2b", iphoneWebgpu), false);
  assert.equal(canStartTier("phone", iphoneWebgpu), true);
  assert.equal(canStartTier("floor", iphoneWebgpu), true);
  assert.equal(canStartTier("rented", iphoneWebgpu), true);
  assert.equal(canStartTier("e2b", desktopWebgpu), true);
});

test("iPhone auto-picks Qwen when WebGPU works, rented when it does not", () => {
  assert.equal(autoPickTier(iphoneWebgpu, {}), "phone");
  assert.equal(autoPickTier(iphoneNoGpu, {}), "rented");
  assert.equal(autoPickTier(desktopWebgpu, {}), "e2b");
});

test("a previous Gemma tab-kill is rewritten into a calm skip on iPhone", () => {
  const raw = "The tab closed or was killed while this pack was loading. On iPhone this is often a memory limit.";
  const note = calmTierError("e2b", iphoneWebgpu, raw);
  assert.match(note || "", /too large for this phone/);
  assert.equal(isSoftTierNote(true, note), true);
  assert.match(skipTierMessage("e2b", iphoneWebgpu), /usual cloud brain/);
});
