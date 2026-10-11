/** Ambient scene: sky gradient, haze, prism light, opal clouds, glass cubes, sparkles, butterflies. CSS-only animation. */
const BUTTERFLIES = [
  { left: "12%", top: "22%", size: 40, delay: "0s", dur: "18s", hue: 190 },
  { left: "78%", top: "16%", size: 34, delay: "-6s", dur: "22s", hue: 300 },
  { left: "84%", top: "52%", size: 28, delay: "-11s", dur: "20s", hue: 260 },
  { left: "8%", top: "60%", size: 32, delay: "-3s", dur: "24s", hue: 320 },
];

function Butterfly({ size, hue }: { size: number; hue: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className="wl-bfly-svg">
      <defs>
        <linearGradient id={`bf${hue}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 95% 78%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 60) % 360} 90% 72%)`} />
        </linearGradient>
      </defs>
      <g className="wl-wing wl-wing-l" fill={`url(#bf${hue})`}>
        <path d="M20 20 C 10 4, 0 8, 4 18 C 6 23, 14 22, 20 20 Z" />
        <path d="M20 21 C 12 24, 6 32, 11 35 C 15 37, 19 29, 20 21 Z" />
      </g>
      <g className="wl-wing wl-wing-r" fill={`url(#bf${hue})`}>
        <path d="M20 20 C 30 4, 40 8, 36 18 C 34 23, 26 22, 20 20 Z" />
        <path d="M20 21 C 28 24, 34 32, 29 35 C 25 37, 21 29, 20 21 Z" />
      </g>
      <rect x="19.3" y="14" width="1.4" height="14" rx="0.7" fill="rgba(255,255,255,0.85)" />
    </svg>
  );
}

export default function Backdrop() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="wl-sky absolute inset-0" />
      <div className="wl-haze wl-haze-a" />
      <div className="wl-haze wl-haze-b" />
      <div className="wl-haze wl-haze-c" />
      <div className="wl-prism" />
      <div className="wilson-field-particles wl-sparkles" />
      <div className="wl-cube" style={{ left: "6%", top: "38%", width: 28, height: 28 }} />
      <div className="wl-cube" style={{ right: "7%", top: "30%", width: 20, height: 20, animationDelay: "-5s" }} />
      <div className="wl-cube" style={{ right: "18%", bottom: "24%", width: 16, height: 16, animationDelay: "-9s" }} />
      <div className="wl-clouds" />
      {BUTTERFLIES.map((b, i) => (
        <div key={i} className="wl-bfly" style={{ left: b.left, top: b.top, animationDelay: b.delay, animationDuration: b.dur }}>
          <Butterfly size={b.size} hue={b.hue} />
        </div>
      ))}
    </div>
  );
}
