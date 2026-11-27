import test from "node:test";
import assert from "node:assert/strict";
import { isSelfFixIntent, titleFromRequest } from "../../src/terminal/selfFixIntent.ts";

test("fix mode treats every message as a self-fix request", () => {
  assert.equal(isSelfFixIntent("plot a sine wave in python", { mode: "fix" }), true);
});

test("app / look / code asks are self-fix even in Python mode or main chat", () => {
  const asks = [
    "add a subtle shimmer effect to the chat title",
    "do shimmer",
    "change your orb glow",
    "make the Back button in the Observatory bigger",
    "update your welcome message",
    "fix your code so the title shimmers",
    "change the look of the header",
  ];
  for (const a of asks) {
    assert.equal(isSelfFixIntent(a, { mode: "python" }), true, a);
    assert.equal(isSelfFixIntent(a, { mode: "chat" }), true, a);
  }
});

test("ordinary Python work is not treated as a self-fix", () => {
  const asks = [
    "write a python script that plots a sine wave",
    "use matplotlib to graph a spiral",
    "calculate fibonacci",
    "install numpy and print hello world",
    "run this code",
  ];
  for (const a of asks) {
    assert.equal(isSelfFixIntent(a, { mode: "python" }), false, a);
    assert.equal(isSelfFixIntent(a, { mode: "chat" }), false, a);
  }
});

test("titles come from her words, not a model invention", () => {
  assert.equal(
    titleFromRequest("add a subtle shimmer effect to the chat title", "Sparkle cleanup"),
    "Add a subtle shimmer effect to the chat title",
  );
  assert.equal(titleFromRequest(""), "Wilson self-update");
});
