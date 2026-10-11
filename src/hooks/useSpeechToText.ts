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

export function useSpeechToText(onFinal: (text: string) => void, onInterim?: (text: string) => void) {
  const [listening, setLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SRInstance | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;
  const supported = getCtor() !== null;

  const update = (v: boolean) => {
    setLocal(v);
    setListening(v); // drives WilsonOrb "listening" pulse
  };

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser. Try Chrome, Edge or Safari.");
      return;
    }
    setError(null);
    finalRef.current = "";
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterimRef.current?.((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Voice error: ${e.error}`);
      }
    };
    rec.onend = () => {
      update(false);
      recRef.current = null;
      const text = finalRef.current.trim();
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      update(true);
    } catch {
      recRef.current = null;
      update(false);
    }
  }, []);

  const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop]);

  useEffect(
    () => () => {
      recRef.current?.abort();
      setListening(false);
    },
    [],
  );

  return { listening, supported, error, start, stop, toggle };
}
