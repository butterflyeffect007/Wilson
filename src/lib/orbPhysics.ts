/** Spring / flick / glow math for the in-app Wilson orb. Visuals only — no mic, no audio graph. */

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export type OrbPhys = {
  px: number; py: number; vx: number; vy: number; // parallax, -1..1
  tx: number; ty: number;                         // tilt target
  ang: number; omega: number;                     // flick spin (deg, deg/s)
  sq: number; sqv: number;                        // tap squish
  amp: number;                                    // smoothed 0..1 glow
  vel: number;                                    // last horizontal flick velocity (deg/s)
};

export function createOrbPhys(): OrbPhys {
  return { px: 0, py: 0, vx: 0, vy: 0, tx: 0, ty: 0, ang: 0, omega: 0, sq: 0, sqv: 0, amp: 0, vel: 0 };
}

/** True when every spring is home — transforms must be cleared so he looks exactly as before. */
export function atRest(p: OrbPhys): boolean {
  return (
    Math.abs(p.px) < 1e-3 && Math.abs(p.py) < 1e-3 &&
    Math.abs(p.vx) < 1e-3 && Math.abs(p.vy) < 1e-3 &&
    Math.abs(p.tx) < 1e-3 && Math.abs(p.ty) < 1e-3 &&
    Math.abs(p.ang) < 0.05 && Math.abs(p.omega) < 4 &&
    Math.abs(p.sq) < 1e-3 && Math.abs(p.sqv) < 1e-2 &&
    p.amp < 0.008
  );
}

export function aimFromPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { tx: number; ty: number } {
  return {
    tx: clamp((clientX - (rect.left + rect.width / 2)) / rect.width, -1, 1),
    ty: clamp((clientY - (rect.top + rect.height / 2)) / rect.height, -1, 1),
  };
}

/** Horizontal drag accumulates spin angle and a smoothed angular velocity. */
export function applyDragSpin(p: OrbPhys, dxPx: number, dt: number, reduced: boolean): void {
  if (reduced || dt <= 0) return;
  const dAng = dxPx * 0.35;
  p.ang += dAng;
  p.vel = p.vel * 0.5 + (dAng / dt) * 0.5;
}

export function beginFlick(p: OrbPhys, msSinceLastMove: number, reduced: boolean): void {
  if (reduced || msSinceLastMove >= 90) return;
  p.omega = clamp(p.vel, -420, 420);
}

export function bumpSquish(p: OrbPhys, reduced: boolean): void {
  if (reduced) return;
  p.sqv += 7;
}

/** Gentle visual breathing. Speak is a bit stronger than listen. Does not touch audio. */
export function simulatedBreath(nowMs: number, mode: "speak" | "listen"): number {
  if (mode === "speak") return 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(nowMs / 420));
  return 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(nowMs / 640));
}

/**
 * Pick a target amplitude for the glow.
 * Wilson speaking: live TTS analyser when it has signal, otherwise a gentle simulated breath
 * (used on iOS/Safari where routing his voice through Web Audio is unsafe).
 * Her voice: only while the mic is already marked active; live mic RMS if a hook published one,
 * otherwise a quieter simulated breath. Never implies opening the mic.
 */
export function pickVisualAmp(opts: {
  speaking: boolean;
  listening: boolean;
  liveAmp: number;
  micAmp: number;
  now: number;
  reduced: boolean;
}): number {
  if (opts.speaking) {
    if (opts.liveAmp > 0.04) return clamp(opts.liveAmp, 0, 1);
    return opts.reduced ? 0.22 : simulatedBreath(opts.now, "speak");
  }
  if (opts.listening) {
    if (opts.micAmp > 0.04) return clamp(opts.micAmp, 0, 1);
    return opts.reduced ? 0.1 : simulatedBreath(opts.now, "listen");
  }
  return 0;
}

export function smoothAmp(amp: number, target: number): number {
  return amp + (target - amp) * (target > amp ? 0.5 : 0.12);
}

export function stepOrb(p: OrbPhys, dt: number, down: boolean): void {
  const t = Math.min(0.05, Math.max(0, dt));
  const k = 90, c = 16;
  p.vx += ((p.tx - p.px) * k - p.vx * c) * t;
  p.px += p.vx * t;
  p.vy += ((p.ty - p.py) * k - p.vy * c) * t;
  p.py += p.vy * t;
  if (!down) {
    p.ang += p.omega * t;
    p.omega *= Math.exp(-t * 1.8);
    if (Math.abs(p.omega) < 4) {
      p.omega = 0;
      p.ang *= Math.exp(-t * 1.6);
      if (Math.abs(p.ang) < 0.05) p.ang = 0;
    }
  }
  p.sqv += (-p.sq * 120 - p.sqv * 9) * t;
  p.sq += p.sqv * t;
}

export function tiltTransform(p: OrbPhys, reduced: boolean): string {
  if (reduced) return "";
  const still = Math.abs(p.px) < 1e-3 && Math.abs(p.py) < 1e-3 && Math.abs(p.sq) < 1e-3;
  if (still) return "";
  return `perspective(700px) rotateX(${(-p.py * 7).toFixed(2)}deg) rotateY(${(p.px * 7).toFixed(2)}deg) scale(${(1 + p.sq * 0.04).toFixed(4)}, ${(1 - p.sq * 0.04).toFixed(4)})`;
}

export function spinTransform(p: OrbPhys, reduced: boolean): string {
  if (reduced || !p.ang) return "";
  return `rotate(${p.ang.toFixed(2)}deg)`;
}

export function sheenStyle(p: OrbPhys, reduced: boolean): { opacity: string; transform: string } {
  if (reduced) return { opacity: "0", transform: "" };
  const sp = clamp(Math.abs(p.omega) / 300, 0, 1);
  return { opacity: (sp * 0.35).toFixed(3), transform: p.ang ? `rotate(${(p.ang * 1.5).toFixed(1)}deg)` : "" };
}

export function causticStyle(p: OrbPhys, reduced: boolean): { opacity: string; transform: string } {
  if (reduced) return { opacity: "0", transform: "" };
  const touch = Math.min(1, Math.hypot(p.px, p.py) * 1.6);
  const op = touch * 0.25 + p.amp * 0.2;
  if (op < 0.001 && Math.abs(p.px) < 1e-3 && Math.abs(p.py) < 1e-3) return { opacity: "0", transform: "" };
  return { opacity: op.toFixed(3), transform: `translate(${(p.px * 22).toFixed(1)}%, ${(p.py * 22).toFixed(1)}%)` };
}

export const TAP_MOVE_PX = 10;
export const TAP_MAX_MS = 600;
export const FLICK_WINDOW_MS = 90;
export const HOME_MS = 400;
export const PARALLAX_PX = 12;
