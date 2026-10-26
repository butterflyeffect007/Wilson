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
const isIOS = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const DENIED_HELP = isAndroid
  ? "Microphone blocked. On Android: tap the lock icon in the address bar → Permissions → Microphone → Allow. Then reload and try the mic again. Also make sure Chrome has mic permission in system settings."
  : "Microphone is blocked. On iPhone: Settings → Apps → Safari → Microphone → Allow (and Settings → Privacy & Security → Speech Recognition → allow Safari). Then tap the mic again.";

// She decides when she's done: no silence cutoff. Only a long idle safety releases a forgotten mic.
const IDLE_SAFETY_MS = 120000;
const STOP_GRACE_MS = 1500;

/**
 * Talk-to-text toggle. Tap to start, tap to stop — the mic never stops on its own for pauses.
 * Browsers (esp. iPhone Safari) end recognition sessions by themselves after a pause; we quietly
 * restart and keep the text gathered so far. The text is only handed over when she taps stop.
 */
export function useSpeechToText(onFinal: (text: string) => void, onInterim?: (text: string) => void) {
  const [listening, setLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SRInstance | null>(null);
  const sessionRef = useRef(0);
  const finalRef = useRef("");
  const wantRef = useRef(false); // true while she has the mic on
  const shownRef = useRef(""); // everything heard so far, including words still being recognized
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
    wantRef.current = false;
    update(false);
    const text = (shownRef.current || finalRef.current).trim();
    finalRef.current = ""; shownRef.current = "";
    if (deliver && text) onFinalRef.current(text);
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current; const session = sessionRef.current;
    wantRef.current = false;
    if (!rec) { update(false); return; }
    try { rec.stop(); } catch { /* ignore */ }
    window.clearTimeout(timers.current.grace);
    timers.current.grace = window.setTimeout(() => { try { rec.abort(); } catch { /* ignore */ } finish(session, true); }, STOP_GRACE_MS);
  }, [finish]);

  const armIdle = () => {
    window.clearTimeout(timers.current.silence);
    timers.current.silence = window.setTimeout(() => stop(), IDLE_SAFETY_MS);
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
    finalRef.current = ""; shownRef.current = "";
    const session = ++sessionRef.current;
    wantRef.current = true;
    let restarts = 0;
    const join = (a: string, b: string) => (a && b && !/\s$/.test(a) && !/^\s/.test(b) ? a + " " + b : a + b);

    const launch = (): boolean => {
      let rec: SRInstance;
      try { rec = new Ctor(); } catch { return false; }
      rec.lang = navigator.language || "en-US";
      rec.continuous = !isIOS; // iOS Safari repeats words in continuous mode; there each phrase ends a run and we restart
      rec.interimResults = true;
      let sessionFinal = ""; // finals from this recognition run only
      rec.onresult = (e) => {
        if (session !== sessionRef.current) return;
        let interim = "", fin = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript;
        }
        sessionFinal = fin;
        shownRef.current = join(join(finalRef.current, sessionFinal), interim).trim();
        onInterimRef.current?.(shownRef.current);
        restarts = 0;
        armIdle();
      };
      rec.onerror = (e) => {
        if (session !== sessionRef.current) return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { setError(DENIED_HELP); wantRef.current = false; }
        else if (e.error !== "no-speech" && e.error !== "aborted" && e.error !== "network") setError(`Mic issue (${e.error}). Tap the mic to try again.`);
      };
      rec.onend = () => {
        if (session !== sessionRef.current) return;
        finalRef.current = join(finalRef.current, sessionFinal);
        sessionFinal = "";
        // The browser stopped on its own (pause, iOS session limit): keep listening until she taps stop.
        if (wantRef.current && restarts < 8) {
          restarts++;
          window.setTimeout(() => { if (wantRef.current && session === sessionRef.current && !launch()) finish(session, true); }, 150);
          return;
        }
        finish(session, true);
      };
      recRef.current = rec;
      try { rec.start(); return true; } catch { return false; }
    };

    if (!launch()) {
      recRef.current = null; wantRef.current = false;
      update(false);
      setError("Couldn't start the microphone. Tap to try again.");
      return;
    }
    update(true);
    armIdle();
  }, [finish]);

  const toggle = useCallback(() => (recRef.current ? stop() : void start()), [start, stop]);
  /** Turn the mic off without delivering anything (she already sent what's in the box). */
  const cancel = useCallback(() => {
    const rec = recRef.current; if (!rec) return;
    finish(sessionRef.current, false);
    try { rec.abort(); } catch { /* ignore */ }
  }, [finish]);

  useEffect(() => () => { clearTimers(); try { recRef.current?.abort(); } catch { /* ignore */ } setListening(false); }, []);

  return { listening, supported, error, start, stop, toggle, cancel };
}
