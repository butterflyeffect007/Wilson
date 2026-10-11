/**
 * Speaker profiles — pure matching logic + localStorage persistence.
 * Only embeddings (numbers) are stored. Never raw audio.
 */
export interface SpeakerProfile {
  id: string;
  name: string; // "" until the user names it
  embeddings: number[][]; // up to MAX_EMBEDDINGS recent
  centroid: number[];
  count: number; // utterances seen
  createdAt: string;
}

export const MAX_EMBEDDINGS = 10;
export const LOW_CONFIDENCE_UTTERANCES = 3;
export const DEFAULT_THRESHOLD = 0.75;
const KEY = "wilson_voice_profiles_v1";

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function mean(vs: number[][]): number[] {
  if (!vs.length) return [];
  const out = new Array(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return out.map((x) => x / vs.length);
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function newProfile(embedding: number[], name = ""): SpeakerProfile {
  return { id: uid(), name, embeddings: [embedding], centroid: [...embedding], count: 1, createdAt: new Date().toISOString() };
}

export function addEmbedding(p: SpeakerProfile, e: number[]): SpeakerProfile {
  const embeddings = [...p.embeddings, e].slice(-MAX_EMBEDDINGS);
  return { ...p, embeddings, centroid: mean(embeddings), count: p.count + 1 };
}

export interface MatchResult {
  profiles: SpeakerProfile[];
  profile: SpeakerProfile;
  score: number;
  isNew: boolean;
  lowConfidence: boolean;
}

/** Best match above threshold → update that profile; else create a new one. */
export function identify(profiles: SpeakerProfile[], e: number[], threshold = DEFAULT_THRESHOLD): MatchResult {
  let best: SpeakerProfile | null = null;
  let score = -1;
  for (const p of profiles) {
    const s = cosine(p.centroid, e);
    if (s > score) { score = s; best = p; }
  }
  if (best && score >= threshold) {
    const updated = addEmbedding(best, e);
    return {
      profiles: profiles.map((p) => (p.id === best!.id ? updated : p)),
      profile: updated, score, isNew: false,
      lowConfidence: updated.count <= LOW_CONFIDENCE_UTTERANCES,
    };
  }
  const p = newProfile(e);
  return { profiles: [...profiles, p], profile: p, score, isNew: true, lowConfidence: true };
}

/** Merge `fromId` into `intoId` (user said "no, this is X" and X exists). */
export function mergeProfiles(profiles: SpeakerProfile[], fromId: string, intoId: string): SpeakerProfile[] {
  const from = profiles.find((p) => p.id === fromId);
  const into = profiles.find((p) => p.id === intoId);
  if (!from || !into || from.id === into.id) return profiles;
  const embeddings = [...into.embeddings, ...from.embeddings].slice(-MAX_EMBEDDINGS);
  const merged = { ...into, embeddings, centroid: mean(embeddings), count: into.count + from.count };
  return profiles.filter((p) => p.id !== fromId).map((p) => (p.id === intoId ? merged : p));
}

/** Split the last embedding off `id` into a new profile (user said "that's not X"). */
export function splitLast(profiles: SpeakerProfile[], id: string, name = ""): { profiles: SpeakerProfile[]; created: SpeakerProfile | null } {
  const p = profiles.find((x) => x.id === id);
  if (!p || !p.embeddings.length) return { profiles, created: null };
  const last = p.embeddings[p.embeddings.length - 1];
  const rest = p.embeddings.slice(0, -1);
  const created = newProfile(last, name);
  const others = profiles.filter((x) => x.id !== id);
  const kept = rest.length ? [{ ...p, embeddings: rest, centroid: mean(rest), count: Math.max(1, p.count - 1) }] : [];
  return { profiles: [...others, ...kept, created], created };
}

export function renameProfile(profiles: SpeakerProfile[], id: string, name: string): SpeakerProfile[] {
  return profiles.map((p) => (p.id === id ? { ...p, name } : p));
}

export function loadProfiles(): SpeakerProfile[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveProfiles(p: SpeakerProfile[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
