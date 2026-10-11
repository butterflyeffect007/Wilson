import React, { useEffect, useRef, useState } from "react";
import { useWilsonAudio } from "@/hooks/useWilsonAudio";
import { getListening, subscribeListening, subscribeRipple, emitRipple } from "@/lib/listeningBus";

import wilsonFluidUrl from "@/assets/wilson-fluid.png";

const wilsonFluid = wilsonFluidUrl;

export type WilsonVibe = "neutral" | "excited" | "calm" | "tired" | "dreaming";

interface WilsonOrbProps {
  isThinking?: boolean;
  speaking?: boolean;
  size?: "sm" | "md" | "lg" | "mdx";
  vibe?: WilsonVibe;
  interactive?: boolean;
  onLongPress?: () => void;
}

const sizeMap = {
  sm: "w-9 h-9",
  md: "w-16 h-16",
  lg: "w-44 h-44 sm:w-52 sm:h-52",
  mdx: "w-24 h-24",
};

const vibeHue: Record<WilsonVibe, number> = {
  neutral: 290,
  excited: 320,
  calm: 190,
  tired: 270,
  dreaming: 160,
};

const WilsonOrb = React.forwardRef<HTMLDivElement, WilsonOrbProps>(
  ({ isThinking = false, speaking, size = "md", vibe = "neutral", interactive = false, onLongPress }, ref) => {
    const { speaking: audioSpeaking, amplitude } = useWilsonAudio();
    const [listening, setListening] = useState<boolean>(getListening());
    const [rippleKey, setRippleKey] = useState(0);
    const [sonarKey, setSonarKey] = useState(0);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const [parallax, setParallax] = useState({ x: 0, y: 0 });

    const isSpeaking = speaking ?? audioSpeaking;
    const intensity = isSpeaking
      ? "speaking"
      : isThinking
      ? "thinking"
      : listening
      ? "listening"
      : "idle";

    useEffect(() => subscribeListening(() => setListening(getListening())), []);
    useEffect(() => subscribeRipple(() => setRippleKey((k) => k + 1)), []);

    const lastPeakAt = useRef(0);
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

    useEffect(() => {
      if (typeof window === "undefined") return;
      if (!window.matchMedia("(pointer: fine)").matches) return;
      const el = innerRef.current;
      if (!el) return;
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = (e.clientX - cx) / window.innerWidth;
        const dy = (e.clientY - cy) / window.innerHeight;
        setParallax({
          x: Math.max(-1, Math.min(1, dx)) * 4,
          y: Math.max(-1, Math.min(1, dy)) * 4,
        });
      };
      window.addEventListener("mousemove", onMove, { passive: true });
      return () => window.removeEventListener("mousemove", onMove);
    }, []);

    const [pulse, setPulse] = useState(0);
    const pressTimer = useRef<number | null>(null);
    const longPressed = useRef(false);
    const orientAsked = useRef(false);
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const followPoint = (clientX: number, clientY: number) => {
      const el = innerRef.current;
      if (!el || reduced) return;
      const r = el.getBoundingClientRect();
      const dx = Math.max(-1, Math.min(1, (clientX - (r.left + r.width / 2)) / r.width));
      const dy = Math.max(-1, Math.min(1, (clientY - (r.top + r.height / 2)) / r.height));
      setParallax({ x: dx * 12, y: dy * 12 });
    };

    const enableTilt = () => {
      if (orientAsked.current || reduced || typeof window === "undefined") return;
      orientAsked.current = true;
      const DOE = (window as any).DeviceOrientationEvent;
      if (!DOE) return;
      const listen = () =>
        window.addEventListener("deviceorientation", (e: DeviceOrientationEvent) => {
          const g = Math.max(-30, Math.min(30, e.gamma ?? 0)) / 30;
          const b = Math.max(-30, Math.min(30, (e.beta ?? 45) - 45)) / 30;
          setParallax({ x: g * 10, y: b * 10 });
        }, { passive: true });
      if (typeof DOE.requestPermission === "function") {
        DOE.requestPermission().then((r: string) => { if (r === "granted") listen(); }).catch(() => {});
      } else listen();
    };

    const handlers = interactive
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            longPressed.current = false;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            followPoint(e.clientX, e.clientY);
            if (onLongPress) pressTimer.current = window.setTimeout(() => { longPressed.current = true; onLongPress(); }, 550);
          },
          onPointerMove: (e: React.PointerEvent) => {
            if (e.buttons || e.pointerType === "touch") followPoint(e.clientX, e.clientY);
          },
          onPointerUp: () => {
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
            pressTimer.current = null;
            if (!longPressed.current) {
              enableTilt();
              emitRipple();
              setPulse((k) => k + 1);
              document.body.classList.remove("wl-scatter");
              void document.body.offsetWidth;
              document.body.classList.add("wl-scatter");
              window.setTimeout(() => document.body.classList.remove("wl-scatter"), 1600);
            }
            window.setTimeout(() => setParallax({ x: 0, y: 0 }), 400);
          },
          onPointerCancel: () => { if (pressTimer.current) window.clearTimeout(pressTimer.current); setParallax({ x: 0, y: 0 }); },
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        }
      : {};

    const reactiveScale = 1 + amplitude * 0.1;
    const reactiveGlow = 0.4 + amplitude * 0.6;
    const reactiveHue = isSpeaking ? amplitude * 60 : 0;
    const aberration = isSpeaking ? amplitude * 2.4 : 0;

    return (
      <div
        ref={ref}
        className={`wilson-orb-shell wilson-orb-shell--${intensity} ${sizeMap[size]} relative flex-shrink-0`}
        style={
          {
            "--wilson-vibe-hue": `${vibeHue[vibe]}`,
            "--wilson-parallax-x": `${parallax.x}px`,
            "--wilson-parallax-y": `${parallax.y}px`,
          } as React.CSSProperties
        }
        aria-hidden={interactive ? undefined : true}
        role={interactive ? "button" : undefined}
        aria-label={interactive ? "Wilson orb. Tap to say hi, hold to talk" : undefined}
        {...handlers}
        data-interactive={interactive ? "true" : undefined}
      >
        {size === "lg" && <span className="wl-orb-base" />}
        <div className="wilson-orb-float absolute inset-0">
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
            className={`wilson-fluid wilson-fluid--${intensity} absolute inset-0`}
            style={
              {
                "--wilson-amp-scale": reactiveScale,
                "--wilson-amp-glow": reactiveGlow,
                "--wilson-amp-hue": `${reactiveHue}deg`,
                "--wilson-amp-aberration": `${aberration}px`,
                backgroundImage: `url(${wilsonFluid})`,
              } as React.CSSProperties
            }
          />

          <span className="wl-orb-highlight" style={{ transform: `translate(${parallax.x * 1.6}px, ${parallax.y * 1.6}px)` }} />
          <span className="wl-orb-rim" />
          {pulse > 0 && <span key={`pulse-${pulse}`} className="wl-orb-pulse" />}
          {isThinking && <span className="wilson-orb-shimmer" />}
        </div>
      </div>
    );
  }
);

WilsonOrb.displayName = "WilsonOrb";

export default WilsonOrb;
