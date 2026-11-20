import test from "node:test";
import assert from "node:assert/strict";
import { callReducer, initialCallState, statusText, endpointDelay, END_OF_TURN_MS, MID_THOUGHT_MS, isLikelyEcho, shouldBargeIn, type CallEvent, type CallState } from "../../src/lib/callMode.ts";

const run = (events: CallEvent[], s: CallState = initialCallState) => events.reduce(callReducer, s);

test("a full back-and-forth turn: listen → think → talk → listen again", () => {
  let s = run([{ type: "MIC_READY" }]);
  assert.equal(s.phase, "listening");
  assert.equal(statusText(s), "Listening…");
  s = run([{ type: "HEARD", text: "hey wilson how" }, { type: "HEARD", text: "hey wilson how are you" }], s);
  assert.equal(s.heard, "hey wilson how are you");
  s = callReducer(s, { type: "TURN_END", text: "hey wilson how are you" });
  assert.equal(s.phase, "thinking");
  assert.equal(statusText(s), "Thinking…");
  s = callReducer(s, { type: "REPLY_STARTED" });
  assert.equal(s.phase, "speaking");
  assert.equal(statusText(s), "Wilson is talking");
  s = callReducer(s, { type: "REPLY_DONE" });
  assert.equal(s.phase, "listening");
  assert.equal(s.heard, "");
  assert.equal(s.turns, 1);
});

test("an empty pause never sends anything", () => {
  const s = run([{ type: "MIC_READY" }, { type: "TURN_END", text: "   " }]);
  assert.equal(s.phase, "listening");
});

test("barge-in while he talks (or thinks) hands her the floor", () => {
  const talking = run([{ type: "MIC_READY" }, { type: "TURN_END", text: "tell me a story" }, { type: "REPLY_STARTED" }]);
  const s = callReducer(talking, { type: "INTERRUPT" });
  assert.equal(s.phase, "listening");
  const thinking = run([{ type: "MIC_READY" }, { type: "TURN_END", text: "hi" }]);
  assert.equal(callReducer(thinking, { type: "INTERRUPT" }).phase, "listening");
  // interrupting while already listening is a no-op
  const l = run([{ type: "MIC_READY" }]);
  assert.equal(callReducer(l, { type: "INTERRUPT" }), l);
});

test("a voice that never starts (down / resting) still goes back to listening", () => {
  const s = run([{ type: "MIC_READY" }, { type: "TURN_END", text: "hi" }, { type: "REPLY_DONE" }]);
  assert.equal(s.phase, "listening");
});

test("ignores stale events: words heard while he talks don't overwrite, REPLY_STARTED only from thinking", () => {
  const talking = run([{ type: "MIC_READY" }, { type: "TURN_END", text: "hi" }, { type: "REPLY_STARTED" }]);
  assert.equal(callReducer(talking, { type: "HEARD", text: "echo" }), talking);
  const l = run([{ type: "MIC_READY" }]);
  assert.equal(callReducer(l, { type: "REPLY_STARTED" }), l);
});

test("idle → paused → resume", () => {
  let s = run([{ type: "MIC_READY" }, { type: "IDLE_TIMEOUT" }]);
  assert.equal(s.phase, "paused");
  assert.match(statusText(s), /Tap the orb/);
  s = callReducer(s, { type: "RESUME" });
  assert.equal(s.phase, "listening");
});

test("End call from any phase is final", () => {
  for (const pre of [[], [{ type: "MIC_READY" }], [{ type: "MIC_READY" }, { type: "TURN_END", text: "x" }], [{ type: "MIC_READY" }, { type: "TURN_END", text: "x" }, { type: "REPLY_STARTED" }]] as CallEvent[][]) {
    const s = run([...pre, { type: "END" }]);
    assert.equal(s.phase, "ended");
    assert.equal(run([{ type: "MIC_READY" }, { type: "REPLY_DONE" }, { type: "RESUME" }], s).phase, "ended");
  }
});

test("mic denied shows the help text", () => {
  const s = callReducer(initialCallState, { type: "MIC_DENIED", message: "Allow the mic" });
  assert.equal(s.phase, "error");
  assert.equal(statusText(s), "Allow the mic");
});

test("end of turn: ~1.4 s normally, longer when she trails off mid-thought", () => {
  assert.ok(END_OF_TURN_MS >= 1200 && END_OF_TURN_MS <= 1600);
  assert.equal(endpointDelay("what's the weather like today"), END_OF_TURN_MS);
  assert.equal(endpointDelay("I was thinking about it."), END_OF_TURN_MS);
  for (const t of ["I went to the store and", "so um", "I want to talk about", "hmm,", "well I was thinking that", "because…"])
    assert.equal(endpointDelay(t), MID_THOUGHT_MS, t);
  assert.ok(MID_THOUGHT_MS > END_OF_TURN_MS);
});

test("echo filter: his own words through the speaker don't interrupt him", () => {
  const spoken = "The ocean is calm today and the light on the water looks like gold.";
  assert.ok(isLikelyEcho("the light on the water looks like", spoken));
  assert.equal(shouldBargeIn("light on the water looks like gold", spoken), false);
  assert.equal(shouldBargeIn("wait hold on Wilson", spoken), true);
  assert.equal(shouldBargeIn("stop", spoken), false); // one word isn't enough (cough / noise)
});
