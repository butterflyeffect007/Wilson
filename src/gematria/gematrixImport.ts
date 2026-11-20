/**
 * Fixed-host gematrix.org import helpers for the Observatory.
 * The worker route stays server-side; this only calls /gematrix and merges phrases.
 */
import type { PhraseEntry } from "./gematria";

export const DEFAULT_GEMATRIX_ENDPOINT = "https://wilson-proxy.butterflyeffect007.workers.dev/gematrix";
export const IMPORT_DEBOUNCE_MS = 550;
export const IMPORT_TIMEOUT_MS = 22000;
export const IMPORT_MIN_INTERVAL_MS = 300;
export const IMPORT_WORD_MAX = 200;

export function normalizeImportWord(word: string): string {
  return word.trim().replace(/\s+/g, " ");
}

export function canImportWord(word: string): boolean {
  const clean = normalizeImportWord(word);
  return clean.length > 0 && clean.length <= IMPORT_WORD_MAX;
}

export async function fetchGematrixMatches(
  word: string,
  signal?: AbortSignal,
  endpoint: string = DEFAULT_GEMATRIX_ENDPOINT,
  cipher?: string,
): Promise<string[]> {
  const clean = normalizeImportWord(word);
  if (!canImportWord(clean)) {
    throw new Error("word must contain 1–200 characters");
  }
  const url = new URL(endpoint, window.location.href);
  url.searchParams.set("word", clean);
  if (cipher) url.searchParams.set("cipher", cipher);
  const res = await fetch(url.toString(), { signal });
  let data: { error?: unknown; phrases?: unknown } = {};
  try {
    data = await res.json();
  } catch {
    throw new Error("The import returned an unreadable response.");
  }
  if (!res.ok) throw new Error(typeof data.error === "string" && data.error ? data.error : "Could not import from gematrix.org.");
  if (!Array.isArray(data.phrases)) throw new Error("The import returned an unreadable response.");
  return [...new Set<string>(
    data.phrases
      .map((item: { phrase?: unknown }) => (typeof item?.phrase === "string" ? normalizeImportWord(item.phrase) : ""))
      .filter((phrase) => phrase.length > 0 && phrase.length <= 250),
  )];
}

export function mergeImportedPhrases(
  library: PhraseEntry[],
  found: string[],
  makeId: () => string = () => crypto.randomUUID(),
): { next: PhraseEntry[]; added: number } {
  const existing = new Set(library.map((entry) => entry.phrase.toUpperCase()));
  const entries: PhraseEntry[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const phrase = normalizeImportWord(raw);
    if (!phrase) continue;
    const key = phrase.toUpperCase();
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      id: "gematrix-" + makeId(),
      phrase,
      category: "gematrix.org",
      source: "Imported from gematrix.org",
    });
  }
  return { next: entries.length ? [...entries, ...library] : library, added: entries.length };
}

export function nextImportDelay(lastNetworkAt: number, now: number, debounceMs = IMPORT_DEBOUNCE_MS, minIntervalMs = IMPORT_MIN_INTERVAL_MS): number {
  if (lastNetworkAt <= 0) return debounceMs;
  const wait = Math.max(0, minIntervalMs - (now - lastNetworkAt));
  return Math.max(debounceMs, wait);
}
