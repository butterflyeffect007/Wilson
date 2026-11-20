import test from "node:test";
import assert from "node:assert/strict";
import {
  aimFromPoint,
  applyDragSpin,
  atRest,
  beginFlick,
  bumpSquish,
  causticStyle,
  clamp,
  createOrbPhys,
  pickVisualAmp,
  sheenStyle,
  simulatedBreath,
  smoothAmp,
  spinTransform,
  stepOrb,
  tiltTransform,
} from "../../src/lib/orbPhysics.ts";

test("clamp stays inside the range", () => {
  assert.equal(clamp(3, 0, 1), 1);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});

test("a fresh orb is at rest, so transforms and shimmer are empty", () => {
  const p = createOrbPhys();
  assert.equal(atRest(p), true);
  assert.equal(tiltTransform(p, false), "");
  assert.equal(spinTransform(p, false), "");
  assert.deepEqual(sheenStyle(p, false), { opacity: "0.000", transform: "" });
  assert.deepEqual(causticStyle(p, false), { opacity: "0", transform: "" });
});

test("aiming at a point to the right and above maps into -1..1", () => {
  const a = aimFromPoint(150, 40, { left: 0, top: 0, width: 100, height: 100 });
  assert.equal(a.tx, 1);
  assert.ok(a.ty < 0);
});

test("a flick to the right leaves residual spin that decays back to rest", () => {
  const p = createOrbPhys();
  applyDragSpin(p, 40, 0.016, false);
  beginFlick(p, 10, false);
  assert.ok(p.omega > 0, `omega ${p.omega}`);
  for (let i = 0; i < 2000; i++) stepOrb(p, 0.016, false);
  assert.equal(p.ang, 0);
  assert.equal(p.omega, 0);
  assert.equal(atRest(p), true);
  assert.equal(spinTransform(p, false), "");
});

test("reduced motion never spins, tilts, or shimmers", () => {
  const p = createOrbPhys();
  applyDragSpin(p, 40, 0.016, true);
  beginFlick(p, 10, true);
  bumpSquish(p, true);
  assert.equal(p.ang, 0);
  assert.equal(p.omega, 0);
  assert.equal(p.sqv, 0);
  p.px = 0.5; p.omega = 200; p.ang = 20;
  assert.equal(tiltTransform(p, true), "");
  assert.equal(spinTransform(p, true), "");
  assert.deepEqual(sheenStyle(p, true), { opacity: "0", transform: "" });
});

test("a tap squish springs back to rest", () => {
  const p = createOrbPhys();
  bumpSquish(p, false);
  assert.ok(p.sqv > 0);
  const mid = tiltTransform(Object.assign(createOrbPhys(), { sq: 1, sqv: 0, px: 0, py: 0 }), false);
  assert.match(mid, /scale\(/);
  for (let i = 0; i < 400; i++) stepOrb(p, 0.016, false);
  assert.ok(Math.abs(p.sq) < 1e-3);
  assert.equal(tiltTransform(p, false), "");
});

test("tilt toward a finger uses perspective and clears once home", () => {
  const p = createOrbPhys();
  p.tx = 1; p.ty = -0.5;
  for (let i = 0; i < 30; i++) stepOrb(p, 0.016, true);
  const t = tiltTransform(p, false);
  assert.match(t, /perspective\(700px\)/);
  assert.match(t, /rotateY\(/);
  p.tx = 0; p.ty = 0;
  for (let i = 0; i < 400; i++) stepOrb(p, 0.016, false);
  assert.equal(tiltTransform(p, false), "");
});

test("sheen is a soft-light opacity from spin, never a hue shift", () => {
  const p = createOrbPhys();
  p.omega = 300; p.ang = 40;
  const s = sheenStyle(p, false);
  assert.equal(s.opacity, "0.350");
  assert.match(s.transform, /rotate\(/);
  assert.equal(Object.keys(s).join(","), "opacity,transform");
});

test("speaking uses live analyser amplitude when it has signal", () => {
  const v = pickVisualAmp({ speaking: true, listening: false, liveAmp: 0.7, micAmp: 0, now: 0, reduced: false });
  assert.equal(v, 0.7);
});

test("speaking without analyser signal uses a gentle simulated breath (iOS path)", () => {
  const a = pickVisualAmp({ speaking: true, listening: false, liveAmp: 0, micAmp: 0, now: 0, reduced: false });
  const b = pickVisualAmp({ speaking: true, listening: false, liveAmp: 0, micAmp: 0, now: 420 * (Math.PI / 2), reduced: false });
  assert.ok(a > 0.17 && a < 0.41);
  assert.ok(Math.abs(a - b) > 0.05, "breath should move over time");
  const reduced = pickVisualAmp({ speaking: true, listening: false, liveAmp: 0, micAmp: 0, now: 0, reduced: true });
  assert.equal(reduced, 0.22);
});

test("her voice only contributes while the mic is already active", () => {
  const quiet = pickVisualAmp({ speaking: false, listening: false, liveAmp: 0, micAmp: 0.9, now: 0, reduced: false });
  assert.equal(quiet, 0, "must not glow from a mic level when the mic is off");
  const live = pickVisualAmp({ speaking: false, listening: true, liveAmp: 0, micAmp: 0.6, now: 0, reduced: false });
  assert.equal(live, 0.6);
  const sim = pickVisualAmp({ speaking: false, listening: true, liveAmp: 0, micAmp: 0, now: 0, reduced: false });
  assert.ok(sim > 0.07 && sim < 0.21);
});

test("speaking wins over listening", () => {
  const v = pickVisualAmp({ speaking: true, listening: true, liveAmp: 0.5, micAmp: 0.9, now: 0, reduced: false });
  assert.equal(v, 0.5);
});

test("smoothAmp attacks faster than it decays", () => {
  assert.ok(smoothAmp(0, 1) > 0.4);
  assert.ok(smoothAmp(1, 0) > 0.8);
});

test("simulated listen breath is quieter than speak breath", () => {
  const s = simulatedBreath(0, "speak");
  const l = simulatedBreath(0, "listen");
  assert.ok(s > l);
});
