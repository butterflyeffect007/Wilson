import { useMemo } from "react";

interface WilsonOrbProps {
  size?: "sm" | "md" | "lg";
  state?: "idle" | "listening" | "thinking" | "speaking";
}

const sizeMap = {
  sm: "w-9 h-9",
  md: "w-16 h-16",
  lg: "w-full h-full",
};

export default function WilsonOrb({ size = "md", state = "idle" }: WilsonOrbProps) {
  const isActive = state === "thinking" || state === "speaking" || state === "listening";

  const gradientId = useMemo(() => `orb-grad-${Math.random().toString(36).slice(2, 7)}`, []);

  return (
    <div className={`relative flex-shrink-0 ${sizeMap[size]} wilson-orb`} aria-hidden="true">
      {/* Soft outer glow */}
      <div
        className={`absolute inset-[-20%] rounded-full wilson-orb-glow ${
          isActive ? "opacity-90" : "opacity-60"
        }`}
        style={{
          background:
            "radial-gradient(circle, rgba(196,181,253,0.45) 0%, rgba(249,168,212,0.25) 40%, transparent 70%)",
        }}
      />

      {/* Main orb */}
      <div className="absolute inset-0 rounded-full overflow-hidden shadow-[0_0_40px_rgba(167,139,250,0.35)]">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <defs>
            <radialGradient id={gradientId} cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#fce7f3" />
              <stop offset="25%" stopColor="#e9d5ff" />
              <stop offset="50%" stopColor="#c4b5fd" />
              <stop offset="75%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#67e8f9" />
            </radialGradient>
            <filter id="soft">
              <feGaussianBlur stdDeviation="1.5" />
            </filter>
          </defs>

          {/* Base sphere */}
          <circle cx="50" cy="50" r="48" fill={`url(#${gradientId})`} />

          {/* Pearl highlight */}
          <ellipse
            cx="38"
            cy="32"
            rx="18"
            ry="12"
            fill="white"
            opacity="0.55"
            filter="url(#soft)"
          />

          {/* Secondary soft light */}
          <ellipse
            cx="62"
            cy="58"
            rx="14"
            ry="10"
            fill="#f0abfc"
            opacity="0.25"
            filter="url(#soft)"
          />

          {/* Subtle inner ring */}
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="white"
            strokeWidth="0.6"
            opacity="0.3"
          />
        </svg>
      </div>

      {/* Inner shimmer when active */}
      {isActive && (
        <div
          className="absolute inset-[15%] rounded-full opacity-40"
          style={{
            background:
              "conic-gradient(from 0deg, transparent, rgba(255,255,255,0.6), transparent, rgba(196,181,253,0.4), transparent)",
            animation: "ring-spin 6s linear infinite",
          }}
        />
      )}
    </div>
  );
}
