import { useCallback, useEffect, useRef, useState } from "react";
import { setListening } from "@/lib/listeningBus";

/* Minimal Web Speech API typings (not in lib.dom for all TS versions). */
interface SRAlternative { transcript: string }
interface SRResult { 0: SRAlternative; isFinal: boolean }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SRInstance;

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

const DENIED_HELP = isAndroid
  ? "Microphone blocked. On Android: tap the lock icon in the address bar → Permissions → Microphone → Allow. Then reload and try the mic again. Also make sure Chrome has mic permission in system settings."
  : "Microphone is blocked. On iPhone: Settings → Apps → Safari → Microphone → Allow (and Settings → Privacy & Security → Speech Recognition → allow Safari). Then tap the mic again.";

const SILENCE_MS = isAndroid ? 3500 : 2500;
const NO_SPEECH_MS = 10000;
const STOP_GRACE_MS = 1500;

/**
 * Talk-to-text toggle. Tap to start, tap to stop, auto-stops after silence.
 * Improved Android (Galaxy/Chrome) reliability: explicit getUserMedia permission request,
 * longer silence window, better error messaging.
 */
export function useSpeechToText(onFinal: (text: string) => void, onInterim?: (text: string) => void) {
  const [listening, setLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SRInstance | null>(null);
  const sessionRef = useRef(0);
  const finalRef = useRef("");
  const timers = useRef<{ silence?: number; grace?: number }>({});
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;
  const supported = getCtor() !== null;

  const update = (v: boolean) => { setLocal(v); setListening(v); };
  const clearTimers = () => { window.clearTimeout(timers.current.silence); window.clearTimeout(timers.current.grace); timers.current = {}; };

  const finish = useCallback((session: number, deliver: boolean) => {
    if (session !== sessionRef.current || !recRef.current) return;
    const rec = recRef.current;
    recRef.current = null;
    clearTimers();
    rec.onresult = null; rec.onerror = null; rec.onend = null;
    update(false);
    const text = finalRef.current.trim();
    finalRef.current = "";
    if (deliver && text) onFinalRef.current(text);
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current; const session = sessionRef.current;
    if (!rec) { update(false); return; }
    try { rec.stop(); } catch { /* ignore */ }
    window.clearTimeout(timers.current.grace);
    timers.current.grace = window.setTimeout(() => { try { rec.abort(); } catch { /* ignore */ } finish(session, true); }, STOP_GRACE_MS);
  }, [finish]);

  const armSilence = (ms: number) => {
    window.clearTimeout(timers.current.silence);
    timers.current.silence = window.setTimeout(() => stop(), ms);
  };

  const start = useCallback(async () => {
    const Ctor = getCtor();
    if (!Ctor) { setError("Voice input isn't supported in this browser. Try Chrome or Safari."); return; }

    // Explicit permission request helps Android Chrome unlock the mic reliably
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {
      setError(DENIED_HELP);
      return;
    }

    if (recRef.current) { const old = recRef.current; finish(sessionRef.current, false); try { old.abort(); } catch { /* ignore */ } }
    setError(null);
    finalRef.current = "";
    const session = ++sessionRef.current;
    let rec: SRInstance;
    try { rec = new Ctor(); } catch { setError("Couldn't start the microphone. Tap to try again."); update(false); return; }
    rec.lang = navigator.language || "en-US";
    rec.continuous = isAndroid;
    rec.interimResults = true;
    rec.onresult = (e) => {
      if (session !== sessionRef.current) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterimRef.current?.((finalRef.current + interim).trim());
      armSilence(SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (session !== sessionRef.current) return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError(DENIED_HELP);
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Mic issue (${e.error}). Tap the mic to try again.`);
      finish(session, true);
    };
    rec.onend = () => finish(session, true);
    recRef.current = rec;
    try {
      rec.start();
      update(true);
      armSilence(NO_SPEECH_MS);
    } catch {
      recRef.current = null;
      update(false);
      setError("Couldn't start the microphone. Tap to try again.");
    }
  }, [finish]);

  const toggle = useCallback(() => (recRef.current ? stop() : void start()), [start, stop]);

  useEffect(() => () => { clearTimers(); try { recRef.current?.abort(); } catch { /* ignore */ } setListening(false); }, []);

  return { listening, supported, error, start, stop, toggle };
}
