import { useEffect, useState } from "react";
import { getAmplitude, getSpeaking, subscribe } from "@/lib/audioBus";

/**
 * Subscribe to Wilson's live TTS playback.
 * Returns whether audio is currently playing and a 0..1 amplitude value
 * that can be used to drive visual reactions (orb shimmer, etc).
 * Brought from original wilsonaibro.
 */
export function useWilsonAudio() {
  const [speaking, setSpeaking] = useState<boolean>(getSpeaking());
  const [amplitude, setAmplitude] = useState<number>(getAmplitude());

  useEffect(() => {
    return subscribe(() => {
      setSpeaking(getSpeaking());
      setAmplitude(getAmplitude());
    });
  }, []);

  return { speaking, amplitude };
}
