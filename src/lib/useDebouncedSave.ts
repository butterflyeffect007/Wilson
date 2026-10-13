import { useEffect, useRef } from "react";
import { beginSave, endSave } from "./saveBus";

/** Debounced persistence (~1.2s pause), flushed immediately on hide/unload so nothing is lost. */
export function useDebouncedSave<T>(value: T, save: (v: T) => void, delay = 1200) {
  const latest = useRef(value);
  const saveRef = useRef(save);
  const timer = useRef<number | null>(null);
  saveRef.current = save;
  latest.current = value;
  useEffect(() => {
    if (timer.current === null) beginSave(); else clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      try { saveRef.current(latest.current); } finally { endSave(); }
    }, delay);
  }, [value, delay]);
  useEffect(() => {
    const flush = () => {
      if (timer.current === null) return;
      clearTimeout(timer.current); timer.current = null;
      try { saveRef.current(latest.current); } finally { endSave(); }
    };
    const vis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", vis);
    return () => { flush(); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); document.removeEventListener("visibilitychange", vis); };
  }, []);
}
