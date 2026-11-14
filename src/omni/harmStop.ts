/**
 * Thin app-level stop only for serious harm to others.
 * This is not a personality rule and is not added to Wilson's brain prompt.
 * It does not lecture, and it does not block ordinary, lawful, or merely blunt talk.
 */

export const HARM_STOP_REPLY = "I won't help with that.";

const WEAPONS =
  /\b(how (?:do|can|would|to)|help me|tell me how|show me how|instructions? (?:for|to)|give me (?:a |the )?steps (?:to|for)|make|build|assemble|synthesize|craft)\b[\s\S]{0,90}\b(pipe ?bomb|nail ?bomb|car ?bomb|letter ?bomb|\bied\b|improvised explosive|explosive device|c-?4\b|thermite|nerve agent|sarin|vx gas|ricin|anthrax weapon|3d[ -]?printed (?:gun|firearm)|ghost gun|undetectable firearm|machine[- ]gun conversion)\b/i;

const WEAPONS_FLIP =
  /\b(pipe ?bomb|nail ?bomb|\bied\b|improvised explosive|nerve agent|sarin|ricin|ghost gun|3d[ -]?printed (?:gun|firearm))\b[\s\S]{0,70}\b(how (?:do|can|to)|instructions?|recipe|tutorial|step[- ]by[- ]step)\b/i;

const HACKING =
  /\b(how (?:do|can|would|to)|help me|write (?:me )?(?:a |an )?(?:script|malware|exploit|ransomware)|give me (?:a |the )?exploit)\b[\s\S]{0,90}\b(break into (?:their|his|her|the|a) (?:account|email|phone|system|network|server)|hack (?:into )?(?:someone|his|her|their) (?:account|email|phone|wifi|system)|steal (?:their |his |her )?(?:passwords?|credentials|ssn|social security)|ransomware|keylogger|phishing kit|bypass (?:2fa|mfa|a login|authentication)|zero[- ]day exploit|falsify (?:records?|evidence|ids?|documents?)|tamper with (?:records?|evidence|logs|the books))\b/i;

const CRIMES_PEOPLE =
  /\b(how (?:do|can|would|to)|help me|plan to|write (?:a |me a )?plan to)\b[\s\S]{0,90}\b(murder(?:ing)? (?:him|her|them|someone|a person)|kill (?:him|her|them|someone|a person)|assassinate|kidnap(?:ping)? (?:him|her|them|someone|a child)|abduct (?:him|her|them|someone|a child)|poison (?:him|her|them|someone)|rape\b|sexually assault|torture (?:him|her|them|someone))\b/i;

/** True only when the text is asking for help carrying out serious harm to others. */
export function seriousHarmStop(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 8) return false;
  return WEAPONS.test(t) || WEAPONS_FLIP.test(t) || HACKING.test(t) || CRIMES_PEOPLE.test(t);
}
