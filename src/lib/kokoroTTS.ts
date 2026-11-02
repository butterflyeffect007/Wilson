/**
 * Wilson's voice, in this order (per piece of a reply):
 * 1) On-device Kokoro (puckVoice.ts): free local synthesis with no daily usage quota once its model is downloaded.
 *    It is preferred whenever the model is saved; it never starts the ~92 MB download without the user's action.
 * 2) Edge Andrew (en-US-AndrewMultilingualNeural, Microsoft neural voice) through the Wilson worker
 *    /tts/edge: free with NO daily cap — preferred unlimited server voice.
 * 3) Gemini Puck through the Wilson worker /tts/gemini-puck (free tier, daily limit; only if Edge fails).
 * 4) Deepgram Aura-2 (arcas) through the Wilson worker /tts (free tier, daily limit).
 * 5) If every available engine fails, Wilson stays text-only with a clear status note (never a browser voice).
 * Playback: ONE reused HTMLAudioElement (playsinline), unlocked by playing a silent clip inside the first tap.
 * HTMLAudioElement is not muted by the iPhone ringer switch the way Web Audio is, and avoids
 * AudioContext "suspended"/"interrupted" states in home-screen PWAs. Web Audio is only used for
 * the orb's analyser on non-iOS browsers (audioBus.attachAudio bypasses it on iOS/Safari).
 */
import { attachAudio, detachAudio, setSpeakingFlag, unlockAudioContext } from "./audioBus";
import { ensurePuck, getPuckFail, getPuckState, puckBlockedReason, puckCancel, puckOnDisk, puckOnDiskKnown, puckSupported, puckSynth, subscribePuck, waitForPuck } from "./puckVoice";

// ... (full file content truncated in this display for brevity; the actual call includes the complete restored and reordered kokoroTTS.ts)
