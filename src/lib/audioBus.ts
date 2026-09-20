// Lightweight audio bus: lets any component subscribe to whether Wilson is
// currently speaking AND the live amplitude of the playing audio (0..1).
// Brought from original wilsonaibro.

type Listener = () => void;

let activeAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let dataArray: Uint8Array | null = null;
let rafId: number | null = null;

let speaking = false;
let amplitude = 0;

const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function ensureContext() {
  if (audioCtx) return audioCtx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function shouldBypassWebAudio(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  return isIOS || isSafari;
}

function tick() {
  if (!analyser || !dataArray) {
    rafId = null;
    return;
  }
  analyser.getByteTimeDomainData(dataArray as unknown as Uint8Array<ArrayBuffer>);
  let sumSq = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = (dataArray[i] - 128) / 128;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / dataArray.length);
  const target = Math.min(1, rms * 3.2);
  amplitude = amplitude * 0.7 + target * 0.3;
  emit();
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  amplitude = 0;
  emit();
}

export function attachAudio(audio: HTMLAudioElement): void {
  if (activeAudio && activeAudio !== audio) {
    detachAudio(activeAudio);
  }
  activeAudio = audio;

  if (shouldBypassWebAudio()) {
    speaking = true;
    emit();
    const handleEnd = () => detachAudio(audio);
    audio.addEventListener("ended", handleEnd, { once: true });
    audio.addEventListener("error", handleEnd, { once: true });
    return;
  }

  const ctx = ensureContext();
  if (!ctx) {
    speaking = true;
    emit();
    const handleEnd = () => detachAudio(audio);
    audio.addEventListener("ended", handleEnd, { once: true });
    audio.addEventListener("error", handleEnd, { once: true });
    return;
  }

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  try {
    const tagged = audio as HTMLAudioElement & { __wilsonSource?: MediaElementAudioSourceNode };
    if (!tagged.__wilsonSource) {
      tagged.__wilsonSource = ctx.createMediaElementSource(audio);
    }
    sourceNode = tagged.__wilsonSource;

    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      dataArray = new Uint8Array(analyser.fftSize);
    }

    sourceNode.disconnect();
    sourceNode.connect(analyser);
    analyser.connect(ctx.destination);
  } catch (err) {
    console.warn("[audioBus] WebAudio wiring failed:", err);
  }

  speaking = true;
  emit();
  startLoop();

  const handleEnd = () => detachAudio(audio);
  audio.addEventListener("ended", handleEnd, { once: true });
  audio.addEventListener("error", handleEnd, { once: true });
}

export function detachAudio(audio?: HTMLAudioElement): void {
  if (audio && activeAudio !== audio) return;
  activeAudio = null;
  speaking = false;
  stopLoop();
}

export function getSpeaking(): boolean {
  return speaking;
}
export function getAmplitude(): number {
  return amplitude;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function unlockAudioContext(): Promise<void> {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* noop */
    }
  }
}
