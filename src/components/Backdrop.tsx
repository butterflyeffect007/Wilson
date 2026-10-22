/** Ambient scene: sky gradient, haze, prism light, opal clouds, glass cubes, sparkles, butterflies. CSS-only animation. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const BUTTERFLIES = [
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

const MINI = [
  { left: "3%", top: "18%", size: 18, dur: "26s", delay: "0s", hue: 300 },
  { left: "91%", top: "34%", size: 15, dur: "30s", delay: "-9s", hue: 190 },
  { left: "4%", top: "68%", size: 14, dur: "28s", delay: "-4s", hue: 260 },
  { left: "90%", top: "78%", size: 17, dur: "32s", delay: "-15s", hue: 330 },
];

export default function Backdrop({ chat = false }: { chat?: boolean }) {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="wl-sky absolute inset-0" />
      <div className="wl-bgimg" />
      <div className="wilson-field-particles wl-sparkles" />
      {chat && MINI.map((b, i) => (
        <span key={i} className="wl-bfly-mini" style={{ left: b.left, top: b.top, animationDuration: b.dur, animationDelay: b.delay }}>
          <Butterfly size={b.size} hue={b.hue} />
        </span>
      ))}
    </div>
  );
}
