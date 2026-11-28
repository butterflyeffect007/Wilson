/**
 * CognitiveMapping — deterministic, explainable signal extraction for Wilson.
 *
 * This module identifies language patterns worth exploring. It never diagnoses,
 * infers a person's hidden beliefs as fact, or stores personal information.
 * The model must validate every hypothesis conversationally with the user.
 */

export type CognitiveSignal =
  | "absolute_language"
  | "global_self_label"
  | "negative_prediction"
  | "catastrophic_prediction"
  | "mind_reading"
  | "helplessness_language"
  | "should_pressure";

export interface CognitiveSignalMatch {
  signal: CognitiveSignal;
  evidence: string;
  gentleQuestion: string;
}

export interface CognitiveMapInput {
  situation: string;
  automaticThought: string;
  emotion?: string;
  behaviorOrUrge?: string;
  knownFacts?: string[];
  desiredDirection?: string;
}

export interface CognitiveMapDraft {
  situation: string;
  automaticThought: string;
  possibleSignals: CognitiveSignalMatch[];
  emotion: string | null;
  behaviorOrUrge: string | null;
  knownFacts: string[];
  alternativePerspective: string;
  nextQuestion: string;
  nextStep: string;
  status: "hypothesis-needs-user-validation";
}

const RULES: Array<{
  signal: CognitiveSignal;
  pattern: RegExp;
  question: string;
}> = [
  {
    signal: "absolute_language",
    pattern: /\b(always|never|every time|nothing ever|no one ever|everyone)\b/i,
    question: "Is this true in every instance, or are there exceptions we should include?",
  },
  {
    signal: "global_self_label",
    pattern: /\b(i am|i'm|im)\s+(a\s+)?(failure|loser|stupid|useless|worthless|unlovable|incapable|broken)\b/i,
    question: "Could we describe what happened without turning it into a definition of who you are?",
  },
  {
    signal: "negative_prediction",
    pattern: /\b(i('ll| will) never|i know (it|this) (won't|will not)|there's no way (i|this)|i('m| am) going to fail)\b/i,
    question: "What do we know so far, and what part is a prediction about what might happen?",
  },
  {
    signal: "catastrophic_prediction",
    pattern: /\b(it('ll| will) be a disaster|everything will fall apart|my life is over|the worst (will|is) happen)\b/i,
    question: "What are the realistic range of outcomes, including the difficult one and the manageable ones?",
  },
  {
    signal: "mind_reading",
    pattern: /\b(they (all )?think i|everyone thinks i'm|they must think|i know (he|she|they) (hate|dislike))\b/i,
    question: "What have they actually said or done, and what are you having to guess?",
  },
  {
    signal: "helplessness_language",
    pattern: /\b(there's nothing i can do|i have no choice|i can't change anything|it's pointless to try)\b/i,
    question: "Which parts are outside your control, and is there one small part you can influence?",
  },
  {
    signal: "should_pressure",
    pattern: /\b(i should have|i must be|i have to be perfect|i shouldn't feel|i should never)\b/i,
    question: "Is that expectation helping you, and would you apply the same standard to someone you care about?",
  },
];

export function detectCognitiveSignals(text: string): CognitiveSignalMatch[] {
  const source = text.trim();
  if (!source) return [];
  return RULES.flatMap(({ signal, pattern, question }) => {
    const match = source.match(pattern);
    return match
      ? [{ signal, evidence: match[0], gentleQuestion: question }]
      : [];
  });
}

/**
 * Builds a conservative first-draft map from information explicitly supplied.
 * Unknown fields remain unknown; Wilson must not fill gaps with assumptions.
 */
export function buildCognitiveMapDraft(input: CognitiveMapInput): CognitiveMapDraft {
  const thought = input.automaticThought.trim();
  const signals = detectCognitiveSignals(thought);
  const alternativePerspective = signals.length
    ? "This thought may be one interpretation rather than the whole picture. Let's check it against the facts before deciding what it means."
    : "Let's hold this interpretation lightly and see what the available facts support.";
  return {
    situation: input.situation.trim(),
    automaticThought: thought,
    possibleSignals: signals,
    emotion: input.emotion?.trim() || null,
    behaviorOrUrge: input.behaviorOrUrge?.trim() || null,
    knownFacts: (input.knownFacts ?? []).map((fact) => fact.trim()).filter(Boolean),
    alternativePerspective,
    nextQuestion: signals[0]?.gentleQuestion
      ?? "What feels most important for us to understand about this situation?",
    nextStep: input.desiredDirection?.trim()
      ? "Choose one small, safe action that moves toward the direction you named, then review what you learn."
      : "Identify one manageable next step only after the person has helped clarify what matters to them.",
    status: "hypothesis-needs-user-validation",
  };
}

/** Counts repeated signal types in the supplied, in-memory message window only. */
export function summarizeRepeatedSignals(messages: string[]): Array<{ signal: CognitiveSignal; count: number }> {
  const counts = new Map<CognitiveSignal, number>();
  for (const message of messages) {
    for (const { signal } of detectCognitiveSignals(message)) {
      counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([signal, count]) => ({ signal, count }))
    .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal));
}

const COGNITIVE_PROFILE_KEY = "wilson_cognitive_signal_counts_v1";
export type CognitiveSignalCounts = Partial<Record<CognitiveSignal, number>>;

/** Aggregate counts only; raw messages and map contents are never persisted. */
export function loadCognitiveSignalCounts(): CognitiveSignalCounts {
  try {
    const raw = localStorage.getItem(COGNITIVE_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const allowed = new Set<CognitiveSignal>(RULES.map((rule) => rule.signal));
    const clean: CognitiveSignalCounts = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (allowed.has(key as CognitiveSignal) && typeof value === "number" && Number.isFinite(value) && value > 0) {
        clean[key as CognitiveSignal] = Math.min(1000, Math.floor(value));
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** Recording is impossible unless the user has explicitly enabled cognitive learning. */
export function recordCognitiveSignals(text: string, enabled: boolean): CognitiveSignalCounts {
  if (!enabled || typeof localStorage === "undefined") return loadCognitiveSignalCounts();
  const counts = loadCognitiveSignalCounts();
  for (const { signal } of detectCognitiveSignals(text)) {
    counts[signal] = Math.min(1000, (counts[signal] ?? 0) + 1);
  }
  try { localStorage.setItem(COGNITIVE_PROFILE_KEY, JSON.stringify(counts)); } catch { /* storage may be unavailable */ }
  return counts;
}

export function clearCognitiveSignalCounts(): void {
  try { localStorage.removeItem(COGNITIVE_PROFILE_KEY); } catch { /* storage may be unavailable */ }
}

/** Compact, private-to-this-request guidance. No raw user text is duplicated. */
export function buildCognitiveSignalContext(userInput: string, recentUserMessages: string[] = [], persistedCounts: CognitiveSignalCounts = {}): string {
  const current = detectCognitiveSignals(userInput);
  const repeated = summarizeRepeatedSignals([...recentUserMessages, userInput]);
  const learned = Object.entries(persistedCounts)
    .filter((entry): entry is [CognitiveSignal, number] => typeof entry[1] === "number" && entry[1] > 1)
    .map(([signal, count]) => ({ signal, count }))
    .sort((a, b) => b.count - a.count);
  if (!current.length && !repeated.length && !learned.length) return "";
  const lines = [
    "[COGNITIVE SIGNALS — tentative prompts, not conclusions]",
    "The following are language-pattern observations only. Do not diagnose, label the person, or assume these patterns explain their circumstances. Validate gently and ask at most one useful question.",
  ];
  if (current.length) {
    lines.push("Possible signals in the current message:");
    for (const item of current) lines.push(`- ${item.signal} (evidence: "${item.evidence}"). Possible question: ${item.gentleQuestion}`);
  }
  if (repeated.length) {
    lines.push("Repeated signal types in the recent user-message window (frequency is not severity or diagnosis):");
    for (const item of repeated) lines.push(`- ${item.signal}: observed ${item.count} times`);
  }
  lines.push("Use this only if relevant. The person's own explanation overrides the heuristic. Do not infer a hidden core belief from wording alone.");
  return lines.join("\n");
}
