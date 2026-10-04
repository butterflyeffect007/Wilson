import React, { useEffect, useRef, useState } from "react";
import { useWilsonAudio } from "@/hooks/useWilsonAudio";
import { getListening, subscribeListening, subscribeRipple } from "@/lib/listeningBus";

import wilsonFluidUrl from "@/assets/wilson-fluid.png";

const wilsonFluid = wilsonFluidUrl;

export type WilsonVibe = "neutral" | "excited" | "calm" | "tired" | "dreaming";

interface WilsonOrbProps {
  isThinking?: boolean;
  speaking?: boolean;
  size?: "sm" | "md" | "lg";
  vibe?: WilsonVibe;
}

const sizeMap = {
  sm: "w-9 h-9",
  md: "w-16 h-16",
  lg: "w-44 h-44 sm:w-52 sm:h-52",
};

const vibeHue: Record<WilsonVibe, number> = {
  neutral: 290,
  excited: 320,
  calm: 190,
  tired: 270,
  dreaming: 160,
};

const WilsonOrb = React.forwardRef<HTMLDivElement, WilsonOrbProps>(
  ({ isThinking = false, speaking, size = "md", vibe = "neutral" }, ref) => {
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
        aria-hidden="true"
      >
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

          {isThinking && <span className="wilson-orb-shimmer" />}
        </div>
      </div>
    );
  }
);

WilsonOrb.displayName = "WilsonOrb";

export default WilsonOrb;
