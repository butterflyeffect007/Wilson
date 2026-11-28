/**
 * Neuroplastic city — a soft neural/synapse map drawn inside the orb,
 * like city lights seen from above. No outline or ring; edges fade out.
 *
 * Subtle at idle, brighter and faster while thinking, and pulsing with
 * voice amplitude while speaking. Cheap 2-D canvas; pauses off-screen.
 */

export type NeuroMode = "idle" | "thinking" | "speaking" | "listening";

type Node = { x: number; y: number; r: number; hue: number; spark: number; phase: number };
type Edge = { a: number; b: number; w: number };
type Pulse = { e: number; t: number; speed: number; hue: number; life: number };

const MAGENTA = 318;
const VIOLET = 278;
const GOLD = 42;
const HUES = [MAGENTA, VIOLET, GOLD, MAGENTA, VIOLET];

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nodeCount(cssSize: number) {
  if (cssSize < 56) return 22;
  if (cssSize < 90) return 40;
  if (cssSize < 140) return 52;
  return 68;
}

export function attachNeuroCity(
  canvas: HTMLCanvasElement,
  opts: {
    getMode: () => NeuroMode;
    getAmp: () => number;
    reduced: () => boolean;
  },
): { stop: () => void } {
  const maybe = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!maybe) return { stop() { /* no canvas */ } };
  const ctx: CanvasRenderingContext2D = maybe;

  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let pulses: Pulse[] = [];
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let visible = true;
  let reducedStatic = false;
  let spawnAcc = 0;

  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) kick();
      }, { threshold: 0.05 })
    : null;
  try { io?.observe(canvas); } catch { /* ignore */ }

  const onVis = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else kick();
  };
  document.addEventListener("visibilitychange", onVis);

  function layout() {
    const rect = canvas.getBoundingClientRect();
    const css = Math.max(1, Math.min(rect.width, rect.height) || canvas.clientWidth || 96);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(1, Math.round(css * dpr));
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    w = px;
    h = px;
    build(css);
  }

  function build(cssSize: number) {
    const rand = mulberry32(0x4e55524f); // "NURO"
    const n = nodeCount(cssSize);
    const cx = w / 2;
    const cy = h / 2;
    const R = w * 0.42;
    nodes = [];
    for (let i = 0; i < n; i++) {
      // Denser toward the core, like a city from above
      const u = rand();
      const rad = R * Math.pow(u, 0.55);
      const ang = rand() * Math.PI * 2;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad * 0.96;
      nodes.push({
        x,
        y,
        r: (0.45 + rand() * 0.7) * dpr,
        hue: HUES[Math.floor(rand() * HUES.length)],
        spark: 0,
        phase: rand() * Math.PI * 2,
      });
    }
    // A few brighter hub nodes near the center
    const hubs = Math.max(2, Math.round(n * 0.04));
    for (let i = 0; i < hubs; i++) {
      const ang = (i / hubs) * Math.PI * 2 + 0.4;
      const rad = R * (0.08 + rand() * 0.12);
      nodes.push({
        x: cx + Math.cos(ang) * rad,
        y: cy + Math.sin(ang) * rad,
        r: (1.05 + rand() * 0.5) * dpr,
        hue: i % 2 ? GOLD : MAGENTA,
        spark: 0,
        phase: rand() * Math.PI * 2,
      });
    }

    edges = [];
    const maxDist = R * (nodes.length > 50 ? 0.28 : 0.36);
    for (let i = 0; i < nodes.length; i++) {
      const near: { j: number; d: number }[] = [];
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d = Math.hypot(dx, dy);
        if (d < maxDist) near.push({ j, d });
      }
      near.sort((a, b) => a.d - b.d);
      const take = Math.min(near.length, 3);
      for (let k = 0; k < take; k++) {
        edges.push({ a: i, b: near[k].j, w: 1 - near[k].d / maxDist });
      }
    }
    pulses = [];
  }

  function modeGain(mode: NeuroMode, amp: number) {
    if (mode === "speaking") return { alpha: 0.38 + amp * 0.35, speed: 1.2 + amp * 1.3, spawn: 9 + amp * 14, spark: 0.5 };
    if (mode === "thinking") return { alpha: 0.48, speed: 1.85, spawn: 14, spark: 0.65 };
    if (mode === "listening") return { alpha: 0.34, speed: 1.05, spawn: 7, spark: 0.3 };
    return { alpha: 0.18, speed: 0.5, spawn: 2.4, spark: 0.1 };
  }

  function spawnPulse(mode: NeuroMode, n: number) {
    if (!edges.length) return;
    for (let i = 0; i < n; i++) {
      if (pulses.length > 22) break;
      const e = Math.floor(Math.random() * edges.length);
      pulses.push({
        e,
        t: 0,
        speed: (0.35 + Math.random() * 0.55) * (mode === "thinking" ? 1.4 : 1),
        hue: HUES[Math.floor(Math.random() * HUES.length)],
        life: 1,
      });
    }
  }

  function draw(now: number) {
    if (!w) layout();
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    const mode = opts.getMode();
    const amp = Math.max(0, Math.min(1, opts.getAmp()));
    const reduced = opts.reduced();
    const g = modeGain(mode, amp);

    if (reduced) {
      if (!reducedStatic) {
        paint(g.alpha * 0.85, 0, true);
        reducedStatic = true;
      }
      raf = 0;
      return;
    }
    reducedStatic = false;

    // Traffic and sparks
    spawnAcc += g.spawn * dt;
    const nSpawn = Math.floor(spawnAcc);
    spawnAcc -= nSpawn;
    if (nSpawn) spawnPulse(mode, nSpawn);

    if (Math.random() < g.spark * dt * 8) {
      const node = nodes[Math.floor(Math.random() * nodes.length)];
      if (node) node.spark = 1;
    }

    for (const node of nodes) {
      node.phase += dt * (mode === "thinking" ? 2.4 : mode === "speaking" ? 1.6 + amp : 0.9);
      if (node.spark > 0) node.spark = Math.max(0, node.spark - dt * 3.2);
    }

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speed * g.speed * dt;
      if (p.t >= 1) pulses.splice(i, 1);
    }

    paint(g.alpha, now, false);
    raf = requestAnimationFrame(draw);
  }

  function paint(alpha: number, now: number, still: boolean) {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // Soft circular falloff — no hard clip, no visible ring
    const cx = w / 2;
    const cy = h / 2;
    const grd = ctx.createRadialGradient(cx, cy, w * 0.04, cx, cy, w * 0.48);
    grd.addColorStop(0, "rgba(255,255,255,0.15)");
    grd.addColorStop(0.28, "rgba(255,255,255,0.7)");
    grd.addColorStop(0.72, "rgba(255,255,255,0.85)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";

    for (const edge of edges) {
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      const midHue = (a.hue + b.hue) / 2;
      ctx.strokeStyle = `hsla(${midHue}, 85%, 68%, ${0.10 + edge.w * 0.16})`;
      ctx.lineWidth = Math.max(0.45, 0.55 * dpr * edge.w);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const p of pulses) {
      const edge = edges[p.e];
      if (!edge) continue;
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      const x = a.x + (b.x - a.x) * p.t;
      const y = a.y + (b.y - a.y) * p.t;
      const glow = 3.2 * dpr;
      const rad = (1.1 + (1 - Math.abs(p.t - 0.5) * 1.2)) * dpr;
      const grdP = ctx.createRadialGradient(x, y, 0, x, y, glow);
      grdP.addColorStop(0, `hsla(${p.hue}, 100%, 74%, 0.85)`);
      grdP.addColorStop(0.45, `hsla(${p.hue}, 95%, 62%, 0.28)`);
      grdP.addColorStop(1, `hsla(${p.hue}, 90%, 55%, 0)`);
      ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(p.t * Math.PI));
      ctx.fillStyle = grdP;
      ctx.beginPath();
      ctx.arc(x, y, glow, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsla(${p.hue}, 100%, 78%, 0.9)`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const node of nodes) {
      const twinkle = still ? 0.5 : 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(node.phase));
      const spark = node.spark;
      const r = node.r * (1 + spark * 1.3);
      const glow = r * (2.2 + spark * 3.4);
      const grdN = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glow);
      grdN.addColorStop(0, `hsla(${node.hue}, 95%, 70%, ${0.28 + spark * 0.45})`);
      grdN.addColorStop(0.4, `hsla(${node.hue}, 90%, 62%, ${0.12 * twinkle + spark * 0.22})`);
      grdN.addColorStop(1, `hsla(${node.hue}, 80%, 55%, 0)`);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = grdN;
      ctx.beginPath();
      ctx.arc(node.x, node.y, glow, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${node.hue}, 100%, ${spark > 0.2 ? 82 : 72}%, ${0.55 + twinkle * 0.3})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    void now;
  }

  function kick() {
    if (raf || !visible || document.hidden) {
      if (visible && !document.hidden && opts.reduced()) draw(performance.now());
      return;
    }
    last = 0;
    raf = requestAnimationFrame(draw);
  }

  const ro = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => { layout(); reducedStatic = false; kick(); })
    : null;
  try { ro?.observe(canvas); } catch { /* ignore */ }

  layout();
  kick();

  return {
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
