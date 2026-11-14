import { useEffect, useRef } from "react";

const ROWS = 85;
const COLS = 125;
const COLORS = ["#00ffcc", "#ff00ff", "#00ffff", "#ffff00", "#ff0055", "#ffffff", "#00ff88"];
const SYMBOLS = ["0", "1", "U", "N", "I", "F", "Y", "Ω", "Ψ", "Δ", "Ξ", "Σ", "Φ", "∞", "✦", "★", "⚡"];

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export default function MatrixField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const draw = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.round(width * (ROWS / COLS));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#05040b";
      context.fillRect(0, 0, width, height);

      const rng = seededRandom(999222);
      const grid = new Float32Array(ROWS * COLS);
      for (let col = 0; col < COLS; col += 1) {
        const head = Math.floor(rng() * ROWS);
        const length = 35 + Math.floor(rng() * 40);
        for (let offset = 0; offset < length; offset += 1) {
          const row = (head - offset + ROWS) % ROWS;
          grid[row * COLS + col] = Math.max(0.01, 1 - offset / length);
        }
      }

      const cellW = width / COLS;
      const cellH = height / ROWS;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = '6px ui-monospace, SFMono-Regular, Menlo, monospace';

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const intensity = grid[row * COLS + col];
          if (intensity <= 0.01) continue;
          const symbol = SYMBOLS[Math.floor(rng() * SYMBOLS.length)];
          context.globalAlpha = intensity;
          context.fillStyle = COLORS[(row * 31 + col * 47) % COLORS.length];
          context.font = intensity > 0.93
            ? 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace'
            : '6px ui-monospace, SFMono-Regular, Menlo, monospace';
          context.fillText(symbol, (col + 0.5) * cellW, (row + 0.5) * cellH);
        }
      }
      context.globalAlpha = 1;
    };

    draw();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", draw);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full rounded-xl border border-violet-300/15"
      role="img"
      aria-label="A dark matrix field of fading rainbow symbols and vertical light trails"
      style={{ background: "#05040b" }}
    />
  );
}
