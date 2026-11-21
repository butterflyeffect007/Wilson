import { useCallback, useEffect, useRef, useState } from "react";
import { setListening } from "@/lib/listeningBus";
import { isVoiceActive, stopSpeaking, subscribeVoiceActive } from "@/lib/kokoroTTS";
import { callReducer, endpointDelay, hasRealSpeech, initialCallState, PATIENCE_MAX_MS, PATIENCE_STEP_MS, shouldBargeIn, type CallEvent, type CallState } from "@/lib/callMode";

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

/** Quiet this long with nothing said: a gentle "still here" note. The call stays open and keeps listening. */
const NUDGE_MS = 60_000;
/** Quiet this long: the mic rests to save battery (tap the orb to pick back up). The call itself never hangs up on silence. */
const IDLE_PAUSE_MS = 5 * 60_000;
/** iPhone: the recognizer refusing to restart this many times in a row (no tap since) → rest, a tap brings it back. */
const MAX_START_FAILS = 4;
const join = (a: string, b: string) => (a && b && !/\s$/.test(a) && !/^\s/.test(b) ? a + " " + b : a + b);
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const MIC_HELP = isIOS
  ? "Wilson can't hear you. On iPhone: Settings → Apps → Safari → Microphone → Allow, and Settings → Privacy & Security → Speech Recognition → allow Safari. Then end the call and start it again."
  : "Wilson can't hear you. Allow the microphone for this site, then end the call and start it again.";

export type CallSend = (text: string, hooks: { onStart: () => void; beforeStart?: () => Promise<void> | void }) => Promise<void>;

type Mode = "turn" | "hold" | "barge";

/**
 * The "Talk with Wilson" call loop: listen → her pause ends the turn → send it as a normal chat message →
 * his normal brain answers → his locked voice speaks it → listen again. Separate from the dictation mic.
 *
 * Turn-taking that tolerates real pauses:
 *  - an unhurried end-of-turn pause (2.2 s, ~3.8 s when she trails off on "and", "um", "like"…), and it grows a
 *    little each time she shows she wasn't done;
 *  - "hold": while he's still thinking (before his voice starts) the mic stays open; if she keeps talking, his
 *    half-made reply is dropped and her turn simply continues with everything she'd said;
 *  - the browser ending a recognition run (iPhone does this after every phrase) never ends her turn: it restarts;
 *  - silence never hangs up: a soft "still here" note at 1 min, the mic rests at 5 min (tap the orb), and only
 *    "End call" ends the call.
 */
export function useTalkCall(opts: { micReady: Promise<boolean> | null; send: CallSend; getSpokenText: () => string; cancelReply?: () => void; onClosed: () => void }) {
  const [state, setState] = useState<CallState>(initialCallState);
  const stateRef = useRef<CallState>(initialCallState);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const recRef = useRef<SRInstance | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const sessionRef = useRef(0);
  const committedRef = useRef("");
  const textRef = useRef("");
  const silenceRef = useRef<number | undefined>(undefined);
  const nudgeRef = useRef<number | undefined>(undefined);
  const idleRef = useRef<number | undefined>(undefined);
  const turnRef = useRef(0);
  const unsubRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);
  const heardEverRef = useRef(false);
  const patienceRef = useRef(0);

  const dispatch = useCallback((e: CallEvent) => {
    const next = callReducer(stateRef.current, e);
    if (next !== stateRef.current) { stateRef.current = next; setState(next); }
  }, []);

  const clearTimers = () => {
    window.clearTimeout(silenceRef.current); window.clearTimeout(nudgeRef.current); window.clearTimeout(idleRef.current);
    silenceRef.current = nudgeRef.current = idleRef.current = undefined;
  };

  const stopRec = useCallback(() => {
    modeRef.current = null;
    sessionRef.current++;
    clearTimers();
    const rec = recRef.current; recRef.current = null;
    if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; try { rec.abort(); } catch { /* ignore */ } }
    setListening(false);
  }, []);

  // forward refs so the recognition callbacks always call the latest versions
  const deliverRef = useRef<() => void>(() => {});
  const interruptRef = useRef<() => void>(() => {});
  const continueRef = useRef<(text: string) => void>(() => {});

  const armQuietTimers = useCallback(() => {
    window.clearTimeout(nudgeRef.current); window.clearTimeout(idleRef.current);
    const quiet = () => modeRef.current === "turn" && !textRef.current;
    nudgeRef.current = window.setTimeout(() => { if (quiet()) dispatch({ type: "NUDGE" }); }, NUDGE_MS);
    idleRef.current = window.setTimeout(() => { if (quiet()) { stopRec(); dispatch({ type: "IDLE_TIMEOUT" }); } }, IDLE_PAUSE_MS);
  }, [dispatch, stopRec]);

  /** Open the mic. `seed` = words already said this turn (kept when she picks a thought back up). */
  const listen = useCallback((mode: Mode, seed = "") => {
    stopRec();
    const Ctor = getCtor();
    if (!Ctor) { dispatch({ type: "MIC_DENIED", message: "Voice calls need the speech recognition in Safari or Chrome. Your typing mic still works." }); return; }
    const session = sessionRef.current;
    modeRef.current = mode;
    committedRef.current = seed; textRef.current = seed;
    if (mode === "turn") { setListening(true); armQuietTimers(); }
    let quickEnds = 0, startFails = 0;
    const live = () => sessionRef.current === session && modeRef.current !== null && aliveRef.current;

    const launch = () => {
      if (!live()) return;
      let rec: SRInstance;
      try { rec = new Ctor(); } catch { dispatch({ type: "MIC_DENIED", message: "Couldn't start the microphone. End the call and try again." }); return; }
      rec.lang = navigator.language || "en-US";
      rec.continuous = !isIOS; // iPhone Safari repeats words in continuous mode; there each phrase ends a run and we restart
      rec.interimResults = true;
      let sessionFinal = "";
      let gotResult = false;
      let refused = false;
      rec.onresult = (e) => {
        if (recRef.current !== rec) return;
        let fin = "", interim = "";
        for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript; }
        sessionFinal = fin; gotResult = true; quickEnds = 0; startFails = 0;
        const fresh = join(fin, interim).trim();
        const text = join(join(committedRef.current, fin), interim).trim();
        if (!text || text === textRef.current) return;
        if (modeRef.current === "barge") {
          textRef.current = text;
          if (shouldBargeIn(text, optsRef.current.getSpokenText())) interruptRef.current();
          return;
        }
        if (modeRef.current === "hold") {
          // He's still thinking and she kept talking: she wasn't done. Same mic run, now her turn again.
          if (!hasRealSpeech(fresh)) return;
          continueRef.current(text);
        }
        heardEverRef.current = true;
        textRef.current = text;
        dispatch({ type: "HEARD", text });
        window.clearTimeout(nudgeRef.current); window.clearTimeout(idleRef.current);
        window.clearTimeout(silenceRef.current);
        silenceRef.current = window.setTimeout(() => deliverRef.current(), endpointDelay(text, undefined, undefined, patienceRef.current));
      };
      rec.onerror = (e) => {
        if (recRef.current !== rec) return;
        if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
          // Before she's ever been heard this is a real "no mic permission". Mid-call, iPhone sometimes refuses a
          // restart that wasn't started by a tap: retry quietly instead of killing the call.
          if (!heardEverRef.current && e.error !== "audio-capture") { stopRec(); dispatch({ type: "MIC_DENIED", message: MIC_HELP }); return; }
          refused = true;
        }
      };
      rec.onend = () => {
        if (recRef.current !== rec) return;
        committedRef.current = join(committedRef.current, sessionFinal);
        if (!live()) return;
        // The browser ended the run on its own (a pause, the iPhone per-phrase limit): her turn is NOT over, keep listening.
        if (refused) {
          if (++startFails >= MAX_START_FAILS) {
            if (modeRef.current === "turn" && textRef.current) { deliverRef.current(); return; } // don't lose what she said
            stopRec(); dispatch({ type: "IDLE_TIMEOUT" }); return; // "Paused. Tap the orb to talk" (a tap re-grants the mic)
          }
          window.setTimeout(launch, 400 * startFails); return;
        }
        if (!gotResult) quickEnds++;
        window.setTimeout(launch, quickEnds > 5 ? 1000 : 120);
      };
      recRef.current = rec;
      try { rec.start(); } catch { window.setTimeout(launch, 600); }
    };
    launch();
  }, [dispatch, stopRec, armQuietTimers]);

  const finishTurn = useCallback((token: number) => {
    if (token !== turnRef.current || !aliveRef.current) return;
    unsubRef.current?.(); unsubRef.current = null;
    dispatch({ type: "REPLY_DONE" });
    listen("turn");
  }, [dispatch, listen]);

  const runTurn = useCallback(async (text: string) => {
    const token = ++turnRef.current;
    // Keep listening while he thinks: if she carries on, her turn continues (see continueRef).
    listen("hold", text);
    try {
      await optsRef.current.send(text, {
        beforeStart: async () => {
          if (token !== turnRef.current) return;
          if (modeRef.current === "hold") {
            stopRec();
            // iPhone: let the mic's audio session close so his voice comes out of the speaker, not the earpiece.
            if (!VOICE_BARGE_IN) await sleep(isIOS ? 250 : 60);
          }
        },
        onStart: () => {
          if (token !== turnRef.current) return;
          dispatch({ type: "REPLY_STARTED" });
          if (VOICE_BARGE_IN) listen("barge"); else stopRec();
        },
      });
    } catch (e) { console.warn("[call]", e); }
    if (token !== turnRef.current) return;
    // Text is done; wait for his voice to finish the last sentence, then hand her the floor.
    if (!isVoiceActive()) { finishTurn(token); return; }
    unsubRef.current?.();
    unsubRef.current = subscribeVoiceActive((a) => { if (!a) finishTurn(token); });
  }, [dispatch, finishTurn, listen, stopRec]);

  deliverRef.current = () => {
    if (modeRef.current !== "turn") return;
    const text = textRef.current.trim();
    if (!text) return;
    stopRec();
    dispatch({ type: "TURN_END", text });
    void runTurn(text);
  };

  continueRef.current = (text: string) => {
    if (stateRef.current.phase !== "thinking") return;
    turnRef.current++; // the reply in flight is now stale
    unsubRef.current?.(); unsubRef.current = null;
    try { optsRef.current.cancelReply?.(); } catch { /* ignore */ }
    if (isVoiceActive()) stopSpeaking();
    patienceRef.current = Math.min(PATIENCE_MAX_MS, patienceRef.current + PATIENCE_STEP_MS);
    modeRef.current = "turn"; // same mic run keeps going
    setListening(true);
    dispatch({ type: "CONTINUE", text });
  };

  interruptRef.current = () => {
    const p = stateRef.current.phase;
    if (p !== "thinking" && p !== "speaking") return;
    turnRef.current++;
    unsubRef.current?.(); unsubRef.current = null;
    if (p === "thinking") { try { optsRef.current.cancelReply?.(); } catch { /* ignore */ } }
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
    // Back from the lock screen / another app: iPhone killed the mic, so restart it right away.
    const onVis = () => {
      if (document.visibilityState !== "visible" || !aliveRef.current) return;
      const m = modeRef.current;
      if (m === "turn") listen("turn", textRef.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; aliveRef.current = false; document.removeEventListener("visibilitychange", onVis); shutdown(); };
  }, [dispatch, listen, shutdown]);

  return { state, tapOrb, end, voiceBargeIn: VOICE_BARGE_IN };
}
