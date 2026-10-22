/**
 * "Hey Wilson" wake word — foreground only, via the browser's Web Speech API (continuous mode).
 * (The on-device transformers/onnx engine is for embeddings + speaker ID, not keyword spotting, and a
 * continuous on-device ASR model would be far too heavy for phones.) Free; no extra servers.
 */
type SR = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null; start(): void; stop(): void; abort(): void };
const Ctor = (): (new () => SR) | null => { const w = window as any; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** iOS Safari/PWA: SpeechRecognition stops after each phrase and needs a tap to restart → not supported. */
export function wakeSupport(): { ok: boolean; reason?: string } {
  if (isIOS()) return { ok: false, reason: "iPhone doesn't allow always-on listening in web apps, so “Hey Wilson” can't work there yet. Tap the mic or long-press the orb instead — or use Siri (below)." };
  if (!Ctor()) return { ok: false, reason: "This browser can't listen continuously. Try Chrome or Edge, or tap the mic." };
  return { ok: true };
}

const WAKE = /\b(?:hey|hi|okay|ok|hay|a)[\s,.!]*wil+son\b[\s,.!?]*/i;

let rec: SR | null = null;
let wanted = false, paused = false, backoff = 500;
let onWake: ((rest: string) => void) | null = null;
const subs = new Set<(armed: boolean) => void>();
const emit = () => { const a = !!rec && wanted && !paused; document.body.classList.toggle("wl-wake-armed", a); subs.forEach((f) => f(a)); };
export const subscribeWake = (f: (armed: boolean) => void) => { subs.add(f); return () => { subs.delete(f); }; };

function launch() {
  const C = Ctor();
  if (!C || !wanted || paused || rec || document.visibilityState !== "visible") return;
  const r = new C();
  r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = true;
  let fired = false;
  r.onresult = (e: any) => {
    if (fired) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t: string = e.results[i][0].transcript;
      const m = t.match(WAKE);
      if (!m) continue;
      const rest = t.slice((m.index ?? 0) + m[0].length).trim();
      // wait for the phrase to finish if words are still coming after the wake word
      if (rest && !e.results[i].isFinal) return;
      fired = true; backoff = 500;
      try { r.abort(); } catch { /* ignore */ }
      onWake?.(rest);
      return;
    }
  };
  r.onerror = (e: any) => { if (e?.error === "not-allowed" || e?.error === "service-not-allowed") { wanted = false; } };
  r.onend = () => { rec = null; emit(); if (wanted && !paused) setTimeout(launch, fired ? 300 : (backoff = Math.min(backoff * 1.6, 8000))); };
  try { r.start(); rec = r; } catch { rec = null; }
  emit();
}

export function startWake(cb: (rest: string) => void) {
  onWake = cb; wanted = true; paused = false; launch();
}
export function stopWake() { wanted = false; try { rec?.abort(); } catch { /* ignore */ } rec = null; emit(); }
/** Pause while tap-to-talk or Wilson's own voice is using the mic/speaker. */
export function pauseWake(p: boolean) {
  paused = p;
  if (p) { try { rec?.abort(); } catch { /* ignore */ } rec = null; emit(); } else { backoff = 500; launch(); }
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") launch(); else { try { rec?.abort(); } catch { /* ignore */ } rec = null; emit(); } });
