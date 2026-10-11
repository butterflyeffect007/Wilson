/**
 * Kokoro TTS — fully in-browser (kokoro-js, Kokoro-82M ONNX). No key needed.
 * Model is lazy-loaded on first spoken reply and cached (browser cache + in-memory).
 * Audio plays through an <audio> element attached to audioBus so WilsonOrb reacts.
 */
import { attachAudio, detachAudio, unlockAudioContext } from "./audioBus";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "am_echo";
const SPEED = 1.1;

let ttsPromise: Promise<any> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let generation = 0;

export type SpeakResult = "success" | "blocked" | "error" | "skipped";

function loadTTS(): Promise<any> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
      try {
        if (hasWebGPU) return await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "fp32", device: "webgpu" });
      } catch { /* fall back to wasm */ }
      return await KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "wasm" });
    })().catch((e) => { ttsPromise = null; throw e; });
  }
  return ttsPromise;
}

export function stopSpeaking(): void {
  generation++;
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

function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

export async function speak(text: string, speed: number = SPEED): Promise<SpeakResult> {
  stopSpeaking();
  const my = generation;
  const speakable = toSpeakable(text);
  if (!speakable) return "skipped";
  try {
    const tts = await loadTTS();
    if (my !== generation) return "skipped";
    const audioOut = await tts.generate(speakable, { voice: VOICE, speed });
    if (my !== generation) return "skipped";
    const blob: Blob = audioOut.toBlob();
    currentUrl = URL.createObjectURL(blob);
    const audio = new Audio(currentUrl);
    currentAudio = audio;
    audio.addEventListener("ended", () => { if (currentAudio === audio) stopSpeaking(); });
    attachAudio(audio);
    try {
      await audio.play();
      return "success";
    } catch (e) {
      detachAudio(audio);
      return (e as Error).name === "NotAllowedError" ? "blocked" : "error";
    }
  } catch (e) {
    console.error("[Kokoro]", e);
    return "error";
  }
}
