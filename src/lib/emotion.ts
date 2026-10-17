/**
 * Prosody-based emotion tagging (fully on-device, pure JS).
 * Note: no browser-ready (ONNX) speech-emotion model was found on Hugging Face,
 * so this is prosody-only. Set SER_MODEL_ID to an ONNX audio-classification
 * repo to blend in a model score later.
 */
export type EmotionTag = "tired" | "frustrated" | "excited" | "calm" | "sad" | "neutral";
export const SER_MODEL_ID: string | null = null;
export const EMOTION_CONFIDENCE_MIN = 0.6;

export interface Prosody { pitchHz: number; pitchVar: number; energyDb: number; wps: number; voicedRatio: number }

export function rmsDb(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(s / Math.max(1, x.length)) + 1e-9);
}

/** Autocorrelation pitch for one frame; 0 if unvoiced. */
export function framePitch(f: Float32Array, sr: number): number {
  const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 70);
  let e0 = 0;
  for (let i = 0; i < f.length; i++) e0 += f[i] * f[i];
  if (e0 < 1e-4) return 0;
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i + lag < f.length; i++) c += f[i] * f[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  return best / e0 > 0.3 && bestLag ? sr / bestLag : 0;
}

export function analyzeProsody(samples: Float32Array, sr: number, words: number): Prosody {
  const frame = Math.floor(sr * 0.04), hop = Math.floor(sr * 0.02);
  const pitches: number[] = [];
  let frames = 0;
  for (let i = 0; i + frame <= samples.length; i += hop) {
    frames++;
    const p = framePitch(samples.subarray(i, i + frame), sr);
    if (p) pitches.push(p);
  }
  const m = pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 0;
  const sd = pitches.length ? Math.sqrt(pitches.reduce((a, b) => a + (b - m) ** 2, 0) / pitches.length) : 0;
  const dur = samples.length / sr;
  return { pitchHz: m, pitchVar: m ? sd / m : 0, energyDb: rmsDb(samples), wps: dur > 0.3 ? words / dur : 0, voicedRatio: frames ? pitches.length / frames : 0 };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** Heuristic scores → best tag + confidence. */
export function classify(p: Prosody): { tag: EmotionTag; confidence: number } {
  if (p.voicedRatio < 0.1) return { tag: "neutral", confidence: 0 };
  const loud = clamp((p.energyDb + 35) / 15);   // ~-35dB quiet → -20dB loud
  const fast = clamp((p.wps - 1.5) / 2);        // 1.5 → 3.5 wps
  const lively = clamp((p.pitchVar - 0.08) / 0.2);
  const scores: Record<EmotionTag, number> = {
    excited: loud * 0.35 + fast * 0.3 + lively * 0.35,
    frustrated: loud * 0.45 + fast * 0.3 + (1 - lively) * 0.25,
    tired: (1 - loud) * 0.4 + (1 - fast) * 0.4 + (1 - lively) * 0.2,
    sad: (1 - loud) * 0.35 + (1 - fast) * 0.25 + (1 - lively) * 0.25 + clamp((160 - p.pitchHz) / 80) * 0.15,
    calm: (1 - Math.abs(loud - 0.4)) * 0.35 + (1 - Math.abs(fast - 0.4)) * 0.35 + (1 - lively) * 0.3 - 0.15,
    neutral: 0.55,
  };
  const sorted = (Object.entries(scores) as [EmotionTag, number][]).sort((a, b) => b[1] - a[1]);
  const [tag, top] = sorted[0];
  const margin = top - sorted[1][1];
  return { tag, confidence: tag === "neutral" ? 0 : clamp(0.5 + margin * 2 + (top - 0.6)) };
}

export const EMOTION_GUIDANCE: Record<EmotionTag, string> = {
  tired: "They sound tired: soften your tone and keep it gentle and warm. Don't shorten or trim your answer because of this; give her the full answer the question deserves.",
  sad: "They sound sad: be warm and gentle, slow down, and don't rush to fix things.",
  frustrated: "They sound frustrated: be patient, steady and warm, never clinical. Don't shorten or trim your answer because of this; give her the full answer the question deserves.",
  excited: "They sound excited: match their energy and enthusiasm.",
  calm: "They sound calm: stay steady and relaxed.",
  neutral: "",
};

export const EMOTION_TTS_SPEED: Record<EmotionTag, number> = {
  tired: 1.0, sad: 0.95, frustrated: 1.1, excited: 1.2, calm: 1.05, neutral: 1.1,
};
