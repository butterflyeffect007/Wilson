/**
 * Dependency-free contract checks for the Gematria calculation core.
 * Invoke runGematriaContractTests() from a test runner or temporary harness.
 */
import {
  calculateCipher,
  digitalRoot,
  findPhraseMatches,
  type PhraseEntry,
} from "./gematria";

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`Gematria contract failed — ${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function runGematriaContractTests(): void {
  equal(calculateCipher("HELLO", "english-ordinal").total, 52, "HELLO ordinal");
  equal(calculateCipher("HELLO", "english-reverse-ordinal").total, 70, "HELLO reverse ordinal");
  equal(calculateCipher("HELLO", "english-reduction").total, 25, "HELLO full reduction");
  equal(calculateCipher("HELLO", "english-reverse-reduction").total, 25, "HELLO reverse reduction");
  equal(calculateCipher("שלום", "hebrew-ordinal").total, 376, "Shalom standard Hebrew");
  equal(calculateCipher("מלך", "hebrew-ordinal").total, 90, "Hebrew final form standard value");
  equal(calculateCipher("מלך", "hebrew-final-large").total, 570, "Hebrew final form large value");
  equal(calculateCipher("123 !", "english-ordinal").total, null, "no matching characters");
  equal(digitalRoot(0), 0, "zero digital root");
  equal(digitalRoot(52), 7, "digital root");
  equal(digitalRoot(-1), null, "negative digital root rejected");

  const phrases: PhraseEntry[] = [
    { id: "1", phrase: "HELLO", category: "test" },
    { id: "2", phrase: "B IF", category: "test" },
    { id: "3", phrase: "WORLD", category: "test" },
  ];
  const matches = findPhraseMatches("HELLO", phrases, "english-ordinal", {
    excludeExactText: true,
    limit: 10,
  });
  equal(matches.length, 1, "phrase matches return only equal totals");
  equal(matches[0]?.phrase, "B IF", "matching phrase is returned");
  equal(findPhraseMatches("!!!", phrases, "english-ordinal").length, 0, "invalid target has no matches");
}
