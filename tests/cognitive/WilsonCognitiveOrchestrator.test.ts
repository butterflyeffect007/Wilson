import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateCognition } from "../../src/core/wilson/WilsonCognitiveOrchestrator.ts";

test("ordinary conversation stays natural instead of becoming a coaching session", () => {
  assert.equal(orchestrateCognition("Good morning, Wilson."), "");
});

test("multiple relevant capabilities can coexist without becoming a fixed sequence", () => {
  const guidance = orchestrateCognition("I can't do this, but imagine if I already had the life I wanted.");
  assert.match(guidance, /limiting certainty/i);
  assert.match(guidance, /imagination/i);
  assert.match(guidance, /not a checklist or sequence/i);
});

test("execution requests receive action-oriented guidance", () => {
  const guidance = orchestrateCognition("Implement the new feature in the existing code.");
  assert.match(guidance, /produce the requested artifact, code/i);
  assert.match(guidance, /rather than asking unnecessary questions/i);
});

test("emotional presence is not automatically converted into reframing", () => {
  const guidance = orchestrateCognition("I'm grieving and I just need to talk.");
  assert.match(guidance, /before trying to change the interpretation/i);
  assert.match(guidance, /Reframing is optional/i);
});

test("immediate danger prioritizes concrete safety rather than mindset work", () => {
  const guidance = orchestrateCognition("I am in danger and someone threatened me.");
  assert.match(guidance, /Prioritize immediate safety and concrete support/i);
  assert.match(guidance, /not a mindset problem/i);
});

test("short conversational continuations may inherit an imaginative thread", () => {
  const guidance = orchestrateCognition("Exactly.", [
    { role: "user", content: "Let's imagine the future as already possible." },
    { role: "assistant", content: "What would that open up?" },
  ]);
  assert.match(guidance, /Give imagination room to operate/i);
});

test("current practical intent is not overridden by an older emotional topic", () => {
  const guidance = orchestrateCognition("Fix the broken build.", [
    { role: "user", content: "I'm overwhelmed and scared." },
  ]);
  assert.match(guidance, /produce the requested artifact, code/i);
  assert.doesNotMatch(guidance, /Attend to the feeling and circumstances/i);
});
