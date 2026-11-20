import assert from "node:assert/strict";
import test from "node:test";
import {
  applyViewportVars,
  computeViewportVars,
  shouldApplyViewportVars,
} from "../../src/lib/visualViewport.ts";

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

test("offsetTop jitter is ignored so the shell is not translated", () => {
  const vars = computeViewportVars(layout, { width: 390, height: 508, offsetTop: 40 });
  assert.equal(vars.appHeight, "508px");
  assert.equal(vars.vvTop, "0px");
  assert.equal(vars.kbInset, "336px");
  assert.equal(vars.keyboardOpen, true);
});

test("a small URL-bar tuck is not treated as a keyboard", () => {
  const vars = computeViewportVars(layout, { width: 390, height: 800, offsetTop: 0 });
  assert.equal(vars.kbInset, "44px");
  assert.equal(vars.keyboardOpen, false);
});

test("CSS vars are not republished for 1px or smaller height flicker", () => {
  const open = computeViewportVars(layout, { width: 390, height: 508, offsetTop: 0 });
  const flickerUp = computeViewportVars(layout, { width: 390, height: 508.6, offsetTop: 12 });
  const flickerDown = computeViewportVars(layout, { width: 390, height: 507.4, offsetTop: 3 });
  assert.equal(shouldApplyViewportVars(open, flickerUp), false);
  assert.equal(shouldApplyViewportVars(open, flickerDown), false);
  const realChange = computeViewportVars(layout, { width: 390, height: 506, offsetTop: 0 });
  assert.equal(shouldApplyViewportVars(open, realChange), true);
  assert.equal(shouldApplyViewportVars(null, open), true);
});

test("applyViewportVars keeps --vv-top at 0 even if a caller passed a stale value", () => {
  const fake = {
    style: {
      store: Object.create(null) as Record<string, string>,
      getPropertyValue(name: string) { return this.store[name] ?? ""; },
      setProperty(name: string, value: string) { this.store[name] = value; },
    },
    classList: { tog: false, toggle(_n: string, on: boolean) { this.tog = on; } },
  };
  applyViewportVars(fake as unknown as HTMLElement, {
    appHeight: "508px",
    vvTop: "40px",
    kbInset: "336px",
    keyboardOpen: true,
  });
  assert.equal(fake.style.getPropertyValue("--vv-top"), "0px");
  assert.equal(fake.style.getPropertyValue("--app-height"), "508px");
  assert.equal(fake.style.getPropertyValue("--kb-inset"), "336px");
});
