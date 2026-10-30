/**
 * Wilson Gematria Observatory — pure calculation core.
 * No UI, network, storage, or AI dependencies.
 */

export type CipherId =
  | "english-ordinal"
  | "english-reverse-ordinal"
  | "english-reduction"
  | "english-reverse-reduction"
  | "hebrew-ordinal"
  | "hebrew-final-large";

export interface CipherDefinition {
  id: CipherId;
  label: string;
  alphabet: "latin" | "hebrew";
  description: string;
}

export interface LetterValue {
  character: string;
  normalized: string;
  value: number;
}

export interface CipherResult {
  cipherId: CipherId;
  label: string;
  total: number | null;
  letters: LetterValue[];
  matchedCharacters: number;
}

export const CIPHERS: readonly CipherDefinition[] = [
  { id: "english-ordinal", label: "English Ordinal", alphabet: "latin", description: "A=1 through Z=26." },
  { id: "english-reverse-ordinal", label: "English Reverse Ordinal", alphabet: "latin", description: "Z=1 through A=26." },
  { id: "english-reduction", label: "English Full Reduction", alphabet: "latin", description: "A=1 through I=9, then repeats 1–9." },
  { id: "english-reverse-reduction", label: "English Reverse Reduction", alphabet: "latin", description: "Reverse ordinal values reduced to 1–9." },
  { id: "hebrew-ordinal", label: "Hebrew Ordinal", alphabet: "hebrew", description: "Standard Hebrew letter values; final forms use their ordinary letter values." },
  { id: "hebrew-final-large", label: "Hebrew Final-Letter Large Values", alphabet: "hebrew", description: "Mispar Gadol-style values for final forms: ך=500, ם=600, ן=700, ף=800, ץ=900." },
] as const;

const ENGLISH: Record<string, number> = Object.fromEntries(
  Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65 + i), i + 1]),
);
const HEBREW: Record<string, number> = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9,
  י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50,
  ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200,
  ש: 300, ת: 400,
};
const HEBREW_FINAL_LARGE: Record<string, number> = {
  ...HEBREW, ך: 500, ם: 600, ן: 700, ף: 800, ץ: 900,
};
const FINAL_FORMS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

export function normalizePhrase(input: string): string {
  return input.normalize("NFKC").toLocaleUpperCase("en-US");
}

function englishValue(character: string, cipherId: CipherId): number | undefined {
  const ordinal = ENGLISH[character];
  if (ordinal === undefined) return undefined;
  if (cipherId === "english-ordinal") return ordinal;
  if (cipherId === "english-reverse-ordinal") return 27 - ordinal;
  if (cipherId === "english-reduction") return ((ordinal - 1) % 9) + 1;
  if (cipherId === "english-reverse-reduction") {
    const reverseOrdinal = 27 - ordinal;
    return ((reverseOrdinal - 1) % 9) + 1;
  }
  return undefined;
}

export function calculateCipher(input: string, cipherId: CipherId): CipherResult {
  const definition = CIPHERS.find((cipher) => cipher.id === cipherId);
  if (!definition) throw new Error(`Unknown cipher: ${cipherId}`);

  const normalized = normalizePhrase(input);
  const letters: LetterValue[] = [];
  for (const character of normalized) {
    let value: number | undefined;
    if (definition.alphabet === "latin") {
      value = englishValue(character, cipherId);
    } else {
      const lookupCharacter =
        cipherId === "hebrew-final-large"
          ? character
          : (FINAL_FORMS[character] ?? character);
      const map = cipherId === "hebrew-final-large" ? HEBREW_FINAL_LARGE : HEBREW;
      value = map[lookupCharacter];
    }
    if (value !== undefined) letters.push({ character, normalized: character, value });
  }

  return {
    cipherId,
    label: definition.label,
    total: letters.length ? letters.reduce((sum, letter) => sum + letter.value, 0) : null,
    letters,
    matchedCharacters: letters.length,
  };
}

export function calculateAll(input: string): CipherResult[] {
  return CIPHERS.map(({ id }) => calculateCipher(input, id));
}

export function digitalRoot(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
  if (value === 0) return 0;
  return 1 + ((value - 1) % 9);
}

/** Exact-total matching against a caller-provided phrase collection. */
export interface PhraseEntry {
  id: string;
  phrase: string;
  category?: string;
  source?: string;
}

export interface PhraseMatch extends PhraseEntry {
  total: number;
  cipherId: CipherId;
}

export function findPhraseMatches(
  target: string,
  entries: readonly PhraseEntry[],
  cipherId: CipherId,
  options: { limit?: number; excludeExactText?: boolean } = {},
): PhraseMatch[] {
  // By default, compare against the entire supplied phrase library.
  // A caller may still request an explicit non-negative limit.
  const limit = options.limit === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor(options.limit));
  if (limit === 0) return [];

  const targetResult = calculateCipher(target, cipherId);
  if (targetResult.total === null) return [];
  const targetNormalized = normalizePhrase(target).replace(/[^A-Z\u0590-\u05FF]/g, "");

  const matches: PhraseMatch[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizePhrase(entry.phrase).replace(/[^A-Z\u0590-\u05FF]/g, "");
    if (!normalized || (options.excludeExactText && normalized === targetNormalized)) continue;
    const dedupeKey = normalized;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const result = calculateCipher(entry.phrase, cipherId);
    if (result.total === targetResult.total) {
      matches.push({ ...entry, total: result.total, cipherId });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
