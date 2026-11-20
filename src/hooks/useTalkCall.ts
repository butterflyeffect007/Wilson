import { useCallback, useEffect, useRef, useState } from "react";
import { setListening } from "@/lib/listeningBus";
import { isVoiceActive, stopSpeaking, subscribeVoiceActive } from "@/lib/kokoroTTS";
import { callReducer, endpointDelay, initialCallState, shouldBargeIn, type CallEvent, type CallState } from "@/lib/callMode";

/* Same Web Speech API the dictation mic uses (webkitSpeechRecognition on iPhone Safari). */
interface SRAlternative { transcript: string }
interface SRResult { 0: SRAlternative; isFinal: boolean }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SRInstance {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SRInstance;
function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const isIOS = typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const isAndroid = /Android/i.test(ua);
/**
 * Voice barge-in (she just starts talking over him) needs the mic open while his voice plays. On iPhone that
 * fights the audio session (his voice drops to the earpiece / recognition hears nothing), and Android beeps on
 * every restart, so there she taps the orb to cut in. Desktop browsers listen while he talks.
 */
export const VOICE_BARGE_IN = !isIOS && !isAndroid;

const IDLE_PAUSE_MS = 90_000; // a call left open in silence stops listening (tap the orb to pick it back up)
const join = (a: string, b: string) => (a && b && !/\s$/.test(a) && !/^\s/.test(b) ? a + " " + b : a + b);

const MIC_HELP = isIOS
  ? "Wilson can't hear you. On iPhone: Settings → Apps → Safari → Microphone → Allow, and Settings → Privacy & Security → Speech Recognition → allow Safari. Then end the call and start it again."
  : "Wilson can't hear you. Allow the microphone for this site, then end the call and start it again.";

export type CallSend = (text: string, hooks: { onStart: () => void }) => Promise<void>;

/**
 * The "Talk with Wilson" call loop: listen → her pause ends the turn → send it as a normal chat message →
 * his normal brain answers → his locked voice speaks it → listen again. Separate from the dictation mic.
 */
export function useTalkCall(opts: { micReady: Promise<boolean> | null; send: CallSend; getSpokenText: () => string; onClosed: () => void }) {
  const [state, setState] = useState<CallState>(initialCallState);
  const stateRef = useRef<CallState>(initialCallState);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const recRef = useRef<SRInstance | null>(null);
  const modeRef = useRef<"turn" | "barge" | null>(null);
  const committedRef = useRef("");
  const textRef = useRef("");
  const silenceRef = useRef<number | undefined>(undefined);
  const idleRef = useRef<number | undefined>(undefined);
  const turnRef = useRef(0);
  const unsubRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);

  const dispatch = useCallback((e: CallEvent) => {
    const next = callReducer(stateRef.current, e);
    if (next !== stateRef.current) { stateRef.current = next; setState(next); }
  }, []);

  const clearTimers = () => { window.clearTimeout(silenceRef.current); window.clearTimeout(idleRef.current); silenceRef.current = idleRef.current = undefined; };

  const stopRec = useCallback(() => {
    modeRef.current = null;
    clearTimers();
    const rec = recRef.current; recRef.current = null;
    if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; try { rec.abort(); } catch { /* ignore */ } }
    setListening(false);
  }, []);

  // forward refs so the recognition callbacks always call the latest versions
  const deliverRef = useRef<() => void>(() => {});
  const interruptRef = useRef<() => void>(() => {});

  const listen = useCallback((mode: "turn" | "barge") => {
    stopRec();
    const Ctor = getCtor();
    if (!Ctor) { dispatch({ type: "MIC_DENIED", message: "Voice calls need the speech recognition in Safari or Chrome. Your typing mic still works." }); return; }
    modeRef.current = mode;
    committedRef.current = ""; textRef.current = "";
    if (mode === "turn") {
      setListening(true);
      idleRef.current = window.setTimeout(() => { if (modeRef.current === "turn" && !textRef.current) { stopRec(); dispatch({ type: "IDLE_TIMEOUT" }); } }, IDLE_PAUSE_MS);
    }
    let quickEnds = 0;

    const launch = () => {
      if (modeRef.current !== mode || !aliveRef.current) return;
      let rec: SRInstance;
      try { rec = new Ctor(); } catch { dispatch({ type: "MIC_DENIED", message: "Couldn't start the microphone. End the call and try again." }); return; }
      rec.lang = navigator.language || "en-US";
      rec.continuous = !isIOS; // iPhone Safari repeats words in continuous mode; there each phrase ends a run and we restart
      rec.interimResults = true;
      let sessionFinal = "";
      let gotResult = false;
      rec.onresult = (e) => {
        if (recRef.current !== rec) return;
        let fin = "", interim = "";
        for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript; }
        sessionFinal = fin; gotResult = true; quickEnds = 0;
        const text = join(join(committedRef.current, fin), interim).trim();
        if (!text || text === textRef.current) return;
        textRef.current = text;
        if (modeRef.current === "barge") {
          if (shouldBargeIn(text, optsRef.current.getSpokenText())) interruptRef.current();
          return;
        }
        dispatch({ type: "HEARD", text });
        window.clearTimeout(idleRef.current);
        window.clearTimeout(silenceRef.current);
        silenceRef.current = window.setTimeout(() => deliverRef.current(), endpointDelay(text));
      };
      rec.onerror = (e) => {
        if (recRef.current !== rec) return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed") { stopRec(); dispatch({ type: "MIC_DENIED", message: MIC_HELP }); }
      };
      rec.onend = () => {
        if (recRef.current !== rec) return;
        committedRef.current = join(committedRef.current, sessionFinal);
        if (modeRef.current !== mode) return;
        // The browser ended the run on its own (a pause, the iPhone per-phrase limit): keep listening.
        if (!gotResult) quickEnds++;
        window.setTimeout(launch, quickEnds > 5 ? 1000 : 150);
      };
      recRef.current = rec;
      try { rec.start(); } catch { window.setTimeout(launch, 600); }
    };
    launch();
  }, [dispatch, stopRec]);

  const finishTurn = useCallback((token: number) => {
    if (token !== turnRef.current || !aliveRef.current) return;
    unsubRef.current?.(); unsubRef.current = null;
    dispatch({ type: "REPLY_DONE" });
    listen("turn");
  }, [dispatch, listen]);

  const runTurn = useCallback(async (text: string) => {
    const token = ++turnRef.current;
    try {
      await optsRef.current.send(text, {
        onStart: () => {
          if (token !== turnRef.current) return;
          dispatch({ type: "REPLY_STARTED" });
          if (VOICE_BARGE_IN) listen("barge");
        },
      });
    } catch (e) { console.warn("[call]", e); }
    if (token !== turnRef.current) return;
    // Text is done; wait for his voice to finish the last sentence, then hand her the floor.
    if (!isVoiceActive()) { finishTurn(token); return; }
    unsubRef.current?.();
    unsubRef.current = subscribeVoiceActive((a) => { if (!a) finishTurn(token); });
  }, [dispatch, finishTurn, listen]);

  deliverRef.current = () => {
    if (modeRef.current !== "turn") return;
    const text = textRef.current.trim();
    if (!text) return;
    stopRec();
    dispatch({ type: "TURN_END", text });
    void runTurn(text);
  };

  interruptRef.current = () => {
    const p = stateRef.current.phase;
    if (p !== "thinking" && p !== "speaking") return;
    turnRef.current++;
    unsubRef.current?.(); unsubRef.current = null;
    stopSpeaking();
    dispatch({ type: "INTERRUPT" });
    listen("turn");
  };

  /** Orb tap: cut him off while he talks; send now if she's said something; pick back up when paused. */
  const tapOrb = useCallback(() => {
    const p = stateRef.current.phase;
    if (p === "thinking" || p === "speaking") interruptRef.current();
    else if (p === "listening") deliverRef.current();
    else if (p === "paused") { dispatch({ type: "RESUME" }); listen("turn"); }
  }, [dispatch, listen]);

  const shutdown = useCallback(() => {
    turnRef.current++;
    unsubRef.current?.(); unsubRef.current = null;
    stopRec();
    if (isVoiceActive()) stopSpeaking();
  }, [stopRec]);

  const end = useCallback(() => {
    shutdown();
    dispatch({ type: "END" });
    optsRef.current.onClosed();
  }, [dispatch, shutdown]);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    void (async () => {
      const ok = await (optsRef.current.micReady ?? Promise.resolve(true));
      if (cancelled) return;
      if (!ok) { dispatch({ type: "MIC_DENIED", message: MIC_HELP }); return; }
      dispatch({ type: "MIC_READY" });
      listen("turn");
    })();
    return () => { cancelled = true; aliveRef.current = false; shutdown(); };
  }, [dispatch, listen, shutdown]);

  return { state, tapOrb, end, voiceBargeIn: VOICE_BARGE_IN };
}
