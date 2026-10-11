/**
 * ElevenLabs TTS — browser-direct with a user-pasted key (stored locally).
 * Feeds audio through audioBus so WilsonOrb reacts to amplitude.
 */
import { attachAudio, detachAudio, unlockAudioContext } from "./audioBus";

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
let currentUrl: string | null = null;

export type SpeakResult = "success" | "blocked" | "error" | "skipped";

export function stopSpeaking(): void {
  currentAbort?.abort();
  currentAbort = null;
  if (currentAudio) {
    currentAudio.pause();
    detachAudio(currentAudio);
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Call from a user gesture (send/mic click) so iOS/Safari allow playback later. */
export function primePlayback(): void {
  void unlockAudioContext();
}

/** Strip markdown so the voice doesn't read symbols aloud. */
function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);
}

export async function speak(text: string, apiKey: string, voiceId: string): Promise<SpeakResult> {
  stopSpeaking();
  const speakable = toSpeakable(text);
  if (!apiKey || !speakable) return "skipped";

  const abort = new AbortController();
  currentAbort = abort;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey, Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: speakable,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: abort.signal,
    });
    if (!res.ok) {
      console.error("[ElevenLabs] error", res.status);
      return "error";
    }
    const blob = await res.blob();
    if (abort.signal.aborted) return "skipped";

    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    currentAudio = audio;
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) stopSpeaking();
    });
    attachAudio(audio);
    try {
      await audio.play();
      return "success";
    } catch (e) {
      detachAudio(audio);
      return (e as Error).name === "NotAllowedError" ? "blocked" : "error";
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "skipped";
    console.error("[ElevenLabs]", e);
    return "error";
  }
}
