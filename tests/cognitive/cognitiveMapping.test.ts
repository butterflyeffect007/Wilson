import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCognitiveMapDraft,
  buildCognitiveSignalContext,
  detectCognitiveSignals,
  summarizeRepeatedSignals,
} from "../../src/core/wilson/CognitiveMapping.ts";

test("detects absolute language without diagnosing the speaker", () => {
  const signals = detectCognitiveSignals("I always mess this up.");
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal, "absolute_language");
  assert.match(signals[0].gentleQuestion, /exceptions/i);
});

test("detects global self-labels and catastrophic predictions", () => {
  const signals = detectCognitiveSignals("I'm a failure and everything will fall apart.");
  assert.deepEqual(signals.map((item) => item.signal), [
    "global_self_label",
    "catastrophic_prediction",
  ]);
});

test("builds a cautious map and leaves unknown details unknown", () => {
  const map = buildCognitiveMapDraft({
    situation: "I got rejected for a job.",
    automaticThought: "I'm incapable.",
    knownFacts: ["I received one rejection."],
  });
  assert.equal(map.status, "hypothesis-needs-user-validation");
  assert.equal(map.emotion, null);
  assert.deepEqual(map.knownFacts, ["I received one rejection."]);
  assert.match(map.alternativePerspective, /one interpretation/i);
});

test("summarizes only repeated signal types in the supplied message window", () => {
  const repeated = summarizeRepeatedSignals([
    "I always fail.",
    "I never get it right.",
    "I should have known better.",
  ]);
  assert.deepEqual(repeated, [{ signal: "absolute_language", count: 2 }]);
});

test("emits no cognitive prompt when no supported language signal appears", () => {
  assert.equal(buildCognitiveSignalContext("I went to the store today."), "");
});

test("marks cognitive signals as tentative and user-validated", () => {
  const context = buildCognitiveSignalContext("I know I'm going to fail.");
  assert.match(context, /tentative prompts, not conclusions/i);
  assert.match(context, /overrides the heuristic/i);
});

test("uses opted-in aggregate counts as tentative cross-session context", () => {
  const context = buildCognitiveSignalContext("A neutral update.", [], { absolute_language: 4 });
  assert.match(context, /Longer-term aggregate signal counts/);
  assert.match(context, /absolute_language: observed 4 times/);
  assert.match(context, /never assume it does/);
});
