import { subscribeVoicePending } from "../lib/kokoroTTS";
import React, { useEffect, useRef, useState } from "react";
import { useWilsonAudio } from "@/hooks/useWilsonAudio";
import { getAmplitude } from "@/lib/audioBus";
import { getListening, subscribeListening, subscribeRipple, emitRipple } from "@/lib/listeningBus";
import {
  applyDragSpin,
  atRest,
  aimFromPoint,
  beginFlick,
  bumpSquish,
  causticStyle,
  createOrbPhys,
  HOME_MS,
  PARALLAX_PX,
  pickVisualAmp,
  sheenStyle,
  smoothAmp,
  spinTransform,
  stepOrb,
  TAP_MAX_MS,
  TAP_MOVE_PX,
  tiltTransform,
  type OrbPhys,
} from "@/lib/orbPhysics";

export type WilsonVibe = "neutral" | "excited" | "calm" | "tired" | "dreaming";

interface WilsonOrbProps {
  isThinking?: boolean;
  speaking?: boolean;
  size?: "sm" | "md" | "lg" | "mdx";
  vibe?: WilsonVibe;
  interactive?: boolean;
  onLongPress?: () => void;
  onTap?: () => void;
}

const sizeMap = {
  sm: "w-9 h-9",
  md: "w-16 h-16",
  lg: "w-[clamp(9.5rem,min(44vw,24dvh),12.5rem)] h-[clamp(9.5rem,min(44vw,24dvh),12.5rem)]",
  mdx: "w-24 h-24",
};

const vibeHue: Record<WilsonVibe, number> = {
  neutral: 290,
  excited: 320,
  calm: 190,
  tired: 270,
  dreaming: 160,
};

// Pastel mood glow only (no hue-rotation of the orb image, never green)
const moodColor: Record<WilsonVibe, string> = {
  neutral: "rgba(205, 170, 255, 0.6)",
  excited: "rgba(255, 160, 220, 0.65)",
  calm: "rgba(160, 225, 255, 0.6)",
  tired: "rgba(210, 190, 250, 0.5)",
  dreaming: "rgba(255, 225, 160, 0.6)",
};

type OrbDebug = { amp: number; ang: number; sq: number; px: number; py: number };

const WilsonOrb = React.forwardRef<HTMLDivElement, WilsonOrbProps>(
  ({ isThinking = false, speaking, size = "md", vibe = "neutral", interactive = false, onLongPress, onTap }, ref) => {
    const { speaking: audioSpeaking, amplitude } = useWilsonAudio();
    const [listening, setListening] = useState<boolean>(getListening());
    const [rippleKey, setRippleKey] = useState(0);
    const [sonarKey, setSonarKey] = useState(0);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const floatRef = useRef<HTMLDivElement | null>(null);
    const sheenRef = useRef<HTMLSpanElement | null>(null);
    const causticRef = useRef<HTMLSpanElement | null>(null);
    const hlRef = useRef<HTMLSpanElement | null>(null);
    const phys = useRef<OrbPhys>(createOrbPhys());
    const pointer = useRef({
      down: false,
      id: null as number | null,
      sx: 0,
      sy: 0,
      lx: 0,
      lt: 0,
      moved: 0,
      t0: 0,
      suppressClick: false,
    });
    const listeningRef = useRef(listening);
    const speakingRef = useRef(false);
    const reducedRef = useRef(false);
    const rafRef = useRef(0);
    const lastFrame = useRef(0);
    const lastPeakAt = useRef(0);

    const isSpeaking = speaking ?? audioSpeaking;
    listeningRef.current = listening;
    speakingRef.current = isSpeaking;
    const intensity = isSpeaking
      ? "speaking"
      : isThinking
      ? "thinking"
      : listening
      ? "listening"
      : "idle";

    const [preparing, setPreparing] = useState(false);
    useEffect(() => subscribeVoicePending(setPreparing), []);
    useEffect(() => subscribeListening(() => setListening(getListening())), []);
    useEffect(() => subscribeRipple(() => setRippleKey((k) => k + 1)), []);

    const setShellRef = (node: HTMLDivElement | null) => {
      shellRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    // Live TTS analyser on desktop; on iOS/Safari audioBus leaves amplitude at 0 so we breathe visually instead.
    useEffect(() => {
      if (!isSpeaking) return;
      if (amplitude > 0.55 && performance.now() - lastPeakAt.current > 220) {
        lastPeakAt.current = performance.now();
        setSonarKey((k) => k + 1);
      }
    }, [amplitude, isSpeaking]);

    useEffect(() => {
      if (!isSpeaking) return;
      document.body.classList.add("wilson-speaking");
      return () => document.body.classList.remove("wilson-speaking");
    }, [isSpeaking]);

    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;

    const applyFrame = (now: number) => {
      const p = phys.current;
      const el = shellRef.current;
      const P = reducedRef.current ? 0 : PARALLAX_PX;
      const gx = p.px * P;
      const gy = p.py * P;
      if (el) {
        el.style.setProperty("--wilson-parallax-x", `${gx.toFixed(2)}px`);
        el.style.setProperty("--wilson-parallax-y", `${gy.toFixed(2)}px`);
        const t = tiltTransform(p, reducedRef.current);
        el.style.transform = t;
      }
      if (innerRef.current) {
        innerRef.current.style.setProperty("--wilson-amp-scale", (1 + p.amp * 0.1).toFixed(4));
        innerRef.current.style.setProperty("--wilson-amp-glow", (0.4 + p.amp * 0.6).toFixed(4));
        innerRef.current.style.setProperty("--wilson-amp-hue", `${speakingRef.current ? p.amp * 60 : 0}deg`);
        innerRef.current.style.setProperty("--wilson-amp-aberration", `${speakingRef.current ? p.amp * 2.4 : 0}px`);
      }
      if (hlRef.current) hlRef.current.style.transform = `translate(${(gx * 1.6).toFixed(2)}px, ${(gy * 1.6).toFixed(2)}px)`;
      if (innerRef.current) {
        const spin = spinTransform(p, reducedRef.current);
        // 0deg is omitted so at rest the image animation is unchanged
        if (spin) innerRef.current.style.setProperty("--wl-spin", `${p.ang.toFixed(2)}deg`);
        else innerRef.current.style.removeProperty("--wl-spin");
      }
      if (sheenRef.current) {
        const s = sheenStyle(p, reducedRef.current);
        sheenRef.current.style.opacity = s.opacity;
        sheenRef.current.style.transform = s.transform;
        sheenRef.current.style.mixBlendMode = Number(s.opacity) > 0.001 ? "soft-light" : "normal";
      }
      if (causticRef.current) {
        const s = causticStyle(p, reducedRef.current);
        causticRef.current.style.opacity = s.opacity;
        causticRef.current.style.transform = s.transform;
        causticRef.current.style.mixBlendMode = Number(s.opacity) > 0.001 ? "soft-light" : "normal";
      }
      const debug: OrbDebug = { amp: p.amp, ang: p.ang, sq: p.sq, px: p.px, py: p.py };
      (window as Window & { __wilsonOrb?: OrbDebug }).__wilsonOrb = debug;
    };

    const pulseAndScatter = () => {
      const floatEl = floatRef.current;
      if (floatEl && !reducedRef.current) {
        const pulse = document.createElement("span");
        pulse.className = "wl-orb-pulse";
        pulse.addEventListener("animationend", () => pulse.remove());
        floatEl.appendChild(pulse);
      }
      document.body.classList.remove("wl-scatter");
      void document.body.offsetWidth;
      document.body.classList.add("wl-scatter");
      window.setTimeout(() => document.body.classList.remove("wl-scatter"), 1600);
    };

    const stopLoop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };

    const ensureLoop = () => {
      if (rafRef.current) return;
      lastFrame.current = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - lastFrame.current) / 1000);
        lastFrame.current = now;
        const p = phys.current;
        stepOrb(p, dt, pointer.current.down);
        const target = pickVisualAmp({
          speaking: speakingRef.current,
          listening: listeningRef.current,
          liveAmp: getAmplitude(),
          micAmp: 0, // never open the mic; hooks may later publish a level from an already-live stream
          now,
          reduced: reducedRef.current,
        });
        p.amp = smoothAmp(p.amp, target);
        applyFrame(now);
        const idle = atRest(p) && !pointer.current.down && !speakingRef.current && !listeningRef.current;
        if (idle) {
          rafRef.current = 0;
          applyFrame(now);
          return;
        }
        rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    useEffect(() => {
      if (isSpeaking || listening) ensureLoop();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSpeaking, listening]);

    useEffect(() => () => stopLoop(), []);

    // Desktop mouse parallax (fine pointer only) — same 4px wander as before, fed into the spring.
    useEffect(() => {
      if (typeof window === "undefined") return;
      if (!window.matchMedia("(pointer: fine)").matches) return;
      const onMove = (e: MouseEvent) => {
        if (pointer.current.down || reducedRef.current) return;
        const el = shellRef.current ?? innerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
        const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
        phys.current.tx = Math.max(-1, Math.min(1, dx)) * (4 / PARALLAX_PX);
        phys.current.ty = Math.max(-1, Math.min(1, dy)) * (4 / PARALLAX_PX);
        ensureLoop();
      };
      window.addEventListener("mousemove", onMove, { passive: true });
      return () => window.removeEventListener("mousemove", onMove);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pressTimer = useRef<number | null>(null);
    const longPressed = useRef(false);
    const orientAsked = useRef(false);

    const enableTilt = () => {
      if (orientAsked.current || reducedRef.current || typeof window === "undefined") return;
      orientAsked.current = true;
      const DOE = (window as unknown as { DeviceOrientationEvent?: { new (): DeviceOrientationEvent; requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      if (!DOE) return;
      const listen = () =>
        window.addEventListener("deviceorientation", (e: DeviceOrientationEvent) => {
          if (pointer.current.down) return;
          const g = Math.max(-30, Math.min(30, e.gamma ?? 0)) / 30;
          const b = Math.max(-30, Math.min(30, (e.beta ?? 45) - 45)) / 30;
          phys.current.tx = g * (10 / PARALLAX_PX);
          phys.current.ty = b * (10 / PARALLAX_PX);
          ensureLoop();
        }, { passive: true });
      if (typeof DOE.requestPermission === "function") {
        DOE.requestPermission().then((r: string) => { if (r === "granted") listen(); }).catch(() => {});
      } else listen();
    };

    const livePointers = interactive || size === "lg";

    const followPoint = (clientX: number, clientY: number) => {
      const el = shellRef.current ?? innerRef.current;
      if (!el || reducedRef.current) return;
      const aim = aimFromPoint(clientX, clientY, el.getBoundingClientRect());
      phys.current.tx = aim.tx;
      phys.current.ty = aim.ty;
    };

    const handlers = livePointers
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            longPressed.current = false;
            pointer.current = {
              down: true,
              id: e.pointerId,
              sx: e.clientX,
              sy: e.clientY,
              lx: e.clientX,
              lt: performance.now(),
              moved: 0,
              t0: performance.now(),
              suppressClick: false,
            };
            phys.current.omega *= 0.3;
            phys.current.vel = 0;
            try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
            followPoint(e.clientX, e.clientY);
            ensureLoop();
            if (interactive && onLongPress) pressTimer.current = window.setTimeout(() => { longPressed.current = true; onLongPress(); }, 550);
          },
          onPointerMove: (e: React.PointerEvent) => {
            const pt = pointer.current;
            if (!pt.down || e.pointerId !== pt.id) {
              if (!pt.down && (e.buttons || e.pointerType === "touch")) followPoint(e.clientX, e.clientY);
              return;
            }
            followPoint(e.clientX, e.clientY);
            const now = performance.now();
            const dt = Math.max(1, now - pt.lt) / 1000;
            pt.moved = Math.max(pt.moved, Math.hypot(e.clientX - pt.sx, e.clientY - pt.sy));
            if (pt.moved > TAP_MOVE_PX && !reducedRef.current) applyDragSpin(phys.current, e.clientX - pt.lx, dt, false);
            pt.lx = e.clientX;
            pt.lt = now;
            ensureLoop();
          },
          onPointerUp: (e: React.PointerEvent) => {
            const pt = pointer.current;
            if (!pt.down || (e.pointerId !== pt.id && pt.id !== null)) return;
            pt.down = false;
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
            pressTimer.current = null;
            const now = performance.now();
            const isTap = pt.moved <= TAP_MOVE_PX && now - pt.t0 < TAP_MAX_MS && !longPressed.current;
            if (isTap) {
              bumpSquish(phys.current, reducedRef.current);
              pulseAndScatter();
              emitRipple();
              if (interactive) {
                onTap?.();
                enableTilt();
              }
            } else if (!longPressed.current) {
              beginFlick(phys.current, now - pt.lt, reducedRef.current);
              if (pt.moved > TAP_MOVE_PX) pt.suppressClick = true;
            }
            window.setTimeout(() => { if (!pointer.current.down) { phys.current.tx = 0; phys.current.ty = 0; } }, HOME_MS);
            ensureLoop();
          },
          onPointerCancel: () => {
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
            pressTimer.current = null;
            pointer.current.down = false;
            phys.current.tx = 0;
            phys.current.ty = 0;
            ensureLoop();
          },
          onClick: (e: React.MouseEvent) => {
            // A flick or long-press should not also fire the parent call-screen button.
            if (pointer.current.suppressClick || longPressed.current) {
              e.preventDefault();
              e.stopPropagation();
              pointer.current.suppressClick = false;
            }
          },
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        }
      : {};

    const reactiveScale = 1 + phys.current.amp * 0.1;
    const reactiveGlow = 0.4 + phys.current.amp * 0.6;
    const reactiveHue = isSpeaking ? phys.current.amp * 60 : 0;
    const aberration = isSpeaking ? phys.current.amp * 2.4 : 0;

    return (
      <div
        ref={setShellRef}
        className={`wilson-orb-shell wilson-orb-shell--${intensity} wilson-orb-size-${size} ${sizeMap[size]} relative flex-shrink-0`}
        style={
          {
            "--wilson-vibe-hue": `${vibeHue[vibe]}`,
            "--wl-mood": moodColor[vibe],
            "--wilson-parallax-x": `0px`,
            "--wilson-parallax-y": `0px`,
          } as React.CSSProperties
        }
        aria-hidden={interactive ? undefined : true}
        role={interactive ? "button" : undefined}
        aria-label={interactive ? "Wilson orb. Tap to say hi, hold to talk" : undefined}
        {...handlers}
        data-interactive={interactive ? "true" : undefined}
      >
        {size === "lg" && <span className="wl-orb-platform" />}
        {size === "lg" && (
          <div className="wl-orb-bflies" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => <span key={i} className={`wl-ob wl-ob-${i}`} />)}
          </div>
        )}
        <div ref={floatRef} className="wilson-orb-float absolute inset-0">
          {/* Soft orbital rings – always present for living presence */}
          <span className="wilson-orb-ring wilson-orb-ring--1" />
          <span className="wilson-orb-ring wilson-orb-ring--2" />
          <span className="wilson-orb-ring wilson-orb-ring--3" />

          {isSpeaking && (
            <span
              key={`sonar-${sonarKey}`}
              className="wilson-orb-sonar"
              style={{ borderColor: `hsl(${vibeHue[vibe]} 80% 65% / 0.7)` }}
            />
          )}
          {rippleKey > 0 && (
            <span
              key={`ripple-${rippleKey}`}
              className="wilson-orb-ripple"
              onAnimationEnd={(e) => (e.currentTarget.style.opacity = "0")}
            />
          )}

          {(isSpeaking || isThinking) && (
            <div className="wilson-orb-sparkles" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <span
                  key={i}
                  className="wilson-orb-sparkle"
                  style={{
                    animationDelay: `${i * 0.35}s`,
                    transform: `rotate(${i * 45}deg)`,
                  }}
                />
              ))}
            </div>
          )}

          <div
            ref={innerRef}
            className={`wilson-fluid wl-orb-img wilson-fluid--${intensity} absolute inset-0`}
            style={
              {
                "--wilson-amp-scale": reactiveScale,
                "--wilson-amp-glow": reactiveGlow,
                "--wilson-amp-hue": `${reactiveHue}deg`,
                "--wilson-amp-aberration": `${aberration}px`,
              } as React.CSSProperties
            }
          />
          <span ref={causticRef} className="wl-orb-caustic" aria-hidden="true" />
          <span ref={sheenRef} className="wl-orb-sheen" aria-hidden="true" />

          <span ref={hlRef} className="wl-orb-highlight" style={{ transform: `translate(0px, 0px)` }} />
          {size !== "sm" && <span className="wl-orb-ring" />}
          {isThinking && <span className="wilson-orb-shimmer" />}
          {preparing && !isSpeaking && !isThinking && <span className="wl-orb-preparing" aria-hidden="true" />}
        </div>
      </div>
    );
  }
);

WilsonOrb.displayName = "WilsonOrb";

export default WilsonOrb;
