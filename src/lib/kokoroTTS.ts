/**
 * Wilson's voice.
 * Primary: Kokoro (kokoro-js, Kokoro-82M ONNX q8, WASM, single thread when not cross-origin isolated).
 * Fallback: Web Speech API (speechSynthesis), best en-US male voice, if Kokoro fails or takes > 20s.
 * Playback goes through ONE AudioContext unlocked on the first user gesture (required on iOS).
 */
import { attachNode, getAudioContext, setSpeakingFlag } from "./audioBus";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "am_echo";
const SPEED = 1.1;
const LOAD_TIMEOUT_MS = 20000;
const SERVER_TTS_URL = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev") + "/tts";
let serverDown = false;

/** In-browser Kokoro only where it can realistically run (not iOS; enough RAM). */
function canRunLocalKokoro(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (iOS) return false;
  const mem = (navigator as any).deviceMemory as number | undefined;
  return mem === undefined ? !/Android/i.test(ua) : mem >= 4;
}

let ttsPromise: Promise<any> | null = null;
let kokoroFailed = false;
let currentSource: AudioBufferSourceNode | null = null;
let detachCurrent: (() => void) | null = null;
let generation = 0;
let unlocked = false;

export type SpeakResult = "success" | "blocked" | "error" | "skipped" | "fallback";
export type VoiceStatus = { state: "idle" | "loading" | "ready" | "fallback" | "unavailable"; progress: number; reason?: string };
let status: VoiceStatus = { state: "idle", progress: 0 };
const statusListeners = new Set<(s: VoiceStatus) => void>();
function setStatus(s: Partial<VoiceStatus>) { status = { ...status, ...s }; statusListeners.forEach((l) => l(status)); }
export function getVoiceStatus() { return status; }
export function subscribeVoiceStatus(l: (s: VoiceStatus) => void) { statusListeners.add(l); return () => { statusListeners.delete(l); }; }

function loadTTS(): Promise<any> {
  if (!ttsPromise) {
    setStatus({ state: "loading", progress: 0 });
    ttsPromise = (async () => {
      const t = await import("@huggingface/transformers");
      const w = (t.env.backends.onnx as any).wasm;
      if (w && !(globalThis as any).crossOriginIsolated) w.numThreads = 1;
      const { KokoroTTS } = await import("kokoro-js");
      const files: Record<string, { loaded: number; total: number }> = {};
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p: any) => {
          if (p?.file && p.total) {
            files[p.file] = { loaded: p.loaded ?? 0, total: p.total };
            const tot = Object.values(files).reduce((a, f) => a + f.total, 0);
            const ld = Object.values(files).reduce((a, f) => a + f.loaded, 0);
            setStatus({ progress: tot ? Math.min(99, Math.round((ld / tot) * 100)) : 0 });
          }
        },
      } as any);
      setStatus({ state: "ready", progress: 100 });
      return tts;
    })().catch((e) => {
      console.warn("[voice] Kokoro failed to load, using device voice:", e);
      kokoroFailed = true;
      setStatus({ state: "fallback", reason: String(e?.message ?? e) });
      ttsPromise = null;
      throw e;
    });
  }
  return ttsPromise;
}

/** Call synchronously inside a user gesture (tap send / mic / orb). Unlocks iOS audio + speech. */
export function primePlayback(): void {
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    if (!unlocked) {
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination); src.start(0);
      } catch { /* ignore */ }
    }
  }
  if (!unlocked && typeof speechSynthesis !== "undefined") {
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
  }
  unlocked = true;
  if (!ttsPromise && !kokoroFailed && canRunLocalKokoro()) void loadTTS().catch(() => {}); // start downloading early
}

export function stopSpeaking(): void {
  generation++;
  try { currentSource?.stop(); } catch { /* ignore */ }
  currentSource = null;
  detachCurrent?.(); detachCurrent = null;
  if (typeof speechSynthesis !== "undefined") { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
  setSpeakingFlag(false);
}

/** Strip markdown, emoji, tags so only clean words are spoken. */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_#>~|<>{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

const MALE_RE = /\b(alex|aaron|fred|daniel|evan|nathan|tom|arthur|reed|rocko|ralph|eddy|grandpa|junior|male|guy|david|mark|christopher|eric|andrew|brian|roger|steffan|davis|jason|tony)\b/i;
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const all = speechSynthesis.getVoices();
  const en = all.filter((v) => /^en[-_]?(US)?/i.test(v.lang));
  const male = en.filter((v) => MALE_RE.test(v.name) && !/female/i.test(v.name));
  const score = (v: SpeechSynthesisVoice) =>
    (/premium/i.test(v.name + v.voiceURI) ? 40 : 0) + (/enhanced/i.test(v.name + v.voiceURI) ? 30 : 0) +
    (/en[-_]US/i.test(v.lang) ? 10 : 0) + (v.localService ? 3 : 0);
  return male.sort((a, b) => score(b) - score(a))[0] ?? null;
}

function speakFallback(text: string, speed: number, my: number): Promise<SpeakResult> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve("error");
    const v = pickVoice();
    if (!v) {
      console.warn("[voice] no male device voice available; staying silent");
      setStatus({ state: "unavailable" });
      return resolve("skipped");
    }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = Math.max(0.8, Math.min(1.3, speed * 0.95));
    u.pitch = 0.95;
    u.onstart = () => { if (my === generation) setSpeakingFlag(true); };
    u.onend = () => { setSpeakingFlag(false); resolve("fallback"); };
    u.onerror = (e) => { console.warn("[voice] speechSynthesis error", e.error); setSpeakingFlag(false); resolve("error"); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

export async function speak(text: string, speed: number = SPEED): Promise<SpeakResult> {
  stopSpeaking();
  const my = generation;
  const speakable = toSpeakable(text);
  if (!speakable) return "skipped";

  // 1) Server-side Echo (Kokoro am_echo) via the Wilson worker
  if (!serverDown) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(SERVER_TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speakable, speed }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (res.status === 503) serverDown = true; // not configured: stop trying this session
      if (res.ok) {
        const data = await res.arrayBuffer();
        if (my !== generation) return "skipped";
        const ctx = getAudioContext();
        if (ctx) {
          if (ctx.state !== "running") { try { await ctx.resume(); } catch { /* ignore */ } }
          const buf = await ctx.decodeAudioData(data);
          if (my !== generation) return "skipped";
          const src = ctx.createBufferSource();
          src.buffer = buf;
          currentSource = src;
          detachCurrent = attachNode(src);
          src.onended = () => { if (currentSource === src) { detachCurrent?.(); detachCurrent = null; currentSource = null; } };
          src.start();
          if (status.state === "unavailable" || status.state === "fallback") setStatus({ state: "ready" });
          return "success";
        }
      }
    } catch (e) {
      console.warn("[voice] server Echo voice failed:", (e as Error).message);
    }
  }
  if (my !== generation) return "skipped";

  // 2) In-browser Kokoro (desktop / capable Android only)
  let tts: any = null;
  if (!kokoroFailed && canRunLocalKokoro()) {
    try {
      tts = await Promise.race([
        loadTTS(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Kokoro load timeout (20s)")), LOAD_TIMEOUT_MS)),
      ]);
    } catch (e) {
      console.warn("[voice] using device voice this time:", (e as Error).message);
      if (status.state !== "ready" && status.state !== "loading") setStatus({ state: "fallback", reason: (e as Error).message });
    }
  }
  if (my !== generation) return "skipped";
  if (!tts) return speakFallback(speakable, speed, my);

  try {
    const out = await tts.generate(speakable, { voice: VOICE, speed });
    if (my !== generation) return "skipped";
    const ctx = getAudioContext();
    if (!ctx) return speakFallback(speakable, speed, my);
    if (ctx.state !== "running") { try { await ctx.resume(); } catch { /* ignore */ } }
    const samples: Float32Array = out.audio;
    const buf = ctx.createBuffer(1, samples.length, out.sampling_rate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    currentSource = src;
    detachCurrent = attachNode(src);
    src.onended = () => { if (currentSource === src) { detachCurrent?.(); detachCurrent = null; currentSource = null; } };
    src.start();
    if (ctx.state !== "running") { console.warn("[voice] AudioContext not running:", ctx.state); return speakFallback(speakable, speed, my); }
    return "success";
  } catch (e) {
    console.warn("[voice] Kokoro generate/playback failed, device voice:", e);
    return speakFallback(speakable, speed, my);
  }
}
