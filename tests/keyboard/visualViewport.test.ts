import assert from "node:assert/strict";
import test from "node:test";
import { computeViewportVars } from "../../src/lib/visualViewport.ts";

const layout = { innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 0 };

test("without a visual viewport, the app fills the layout height and has no keyboard inset", () => {
  const vars = computeViewportVars(layout, null);
  assert.equal(vars.appHeight, "844px");
  assert.equal(vars.vvTop, "0px");
  assert.equal(vars.kbInset, "0px");
  assert.equal(vars.keyboardOpen, false);
});

test("a shrunk visual viewport (iPhone keyboard) sets app height and keyboard inset", () => {
  const vars = computeViewportVars(layout, { width: 390, height: 508, offsetTop: 0 });
  assert.equal(vars.appHeight, "508px");
  assert.equal(vars.vvTop, "0px");
  assert.equal(vars.kbInset, "336px");
  assert.equal(vars.keyboardOpen, true);
});

test("offsetTop is included so a shifted visual viewport still fits the visible area", () => {
  const vars = computeViewportVars(layout, { width: 390, height: 508, offsetTop: 40 });
  assert.equal(vars.appHeight, "508px");
  assert.equal(vars.vvTop, "40px");
  assert.equal(vars.kbInset, "296px");
  assert.equal(vars.keyboardOpen, true);
});

test("a small URL-bar tuck is not treated as a keyboard", () => {
  const vars = computeViewportVars(layout, { width: 390, height: 800, offsetTop: 0 });
  assert.equal(vars.kbInset, "44px");
  assert.equal(vars.keyboardOpen, false);
});
