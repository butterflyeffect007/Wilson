/**
 * Wilson's fluid cognitive orchestrator.
 *
 * It composes turn-specific guidance from the user's actual request and nearby
 * conversational context. Signals are lightweight relevance cues, never user
 * labels, scores, diagnoses, or a mandatory sequence. Several can coexist;
 * none is required to run on every turn.
 */

import type { ModelMessage } from "../../intelligence/ModelRequest";

type CognitiveSignal =
  | "execution"
  | "emotional-presence"
  | "limiting-assumption"
  | "imagination"
  | "evidence"
  | "decision"
  | "creation"
  | "immediate-safety";

const SIGNALS: ReadonlyArray<{ signal: CognitiveSignal; pattern: RegExp }> = [
  { signal: "immediate-safety", pattern: /\b(being hurt|hurt me|threaten(?:ed|ing)?|unsafe|in danger|can't breathe|overdose|suicid(?:e|al)|kill myself|abuse|emergency|urgent medical)\b/i },
  { signal: "execution", pattern: /\b(build|implement|code|write|draft|create|make|fix|debug|deploy|connect|configure|ship|edit|generate|produce|do it|take action)\b/i },
  { signal: "emotional-presence", pattern: /\b(i feel|i'm feeling|i am feeling|i'm scared|i am scared|i'm grieving|i miss|i'm overwhelmed|i am overwhelmed|i'm exhausted|i am exhausted|i'm hurt|i am hurt|i'm lonely|i am lonely|i'm anxious|i am anxious|i'm upset|i am upset|i just need to talk)\b/i },
  { signal: "limiting-assumption", pattern: /\b(i can't|i cannot|i'll never|i will never|i'm not capable|i am not capable|i'm a failure|i am a failure|it's too late|it is too late|that's just who i am|that is just who i am|there's no way|there is no way|i'm not good enough|i am not good enough)\b/i },
  { signal: "imagination", pattern: /\b(imagine|imagination|visuali[sz]e|assume the feeling|fulfilled wish|wish fulfilled|highest self|future self|manifest|dream life|as if it were real|neville goddard)\b/i },
  { signal: "evidence", pattern: /\b(research|source|evidence|verify|fact.check|is it true|what do we know|prove|data|study|studies|paper|citation|current|latest)\b/i },
  { signal: "decision", pattern: /\b(should i|should we|which one|choose|decision|decide|trade.off|pros and cons|what's the best|what is the best|options|alternative)\b/i },
  { signal: "creation", pattern: /\b(idea|invent|design|concept|brainstorm|what if|possibilit(?:y|ies)|rethink|reimagine|new approach|breakthrough)\b/i },
];

const GUIDANCE: Record<CognitiveSignal, string> = {
  "immediate-safety": "Prioritize immediate safety and concrete support. Do not treat danger, abuse, urgent symptoms, or material risk as a mindset problem. Be direct about uncertainty and appropriate real-world help.",
  execution: "The person is asking for forward motion. Produce the requested artifact, code, decision, or concrete work where possible. Inspect relevant existing work first; preserve working behavior and avoid substituting a discussion of the task for doing it.",
  "emotional-presence": "Attend to the feeling and circumstances before trying to change the interpretation. Do not turn vulnerability into a coaching exercise. Reframing is optional and should wait until it is welcome and useful.",
  "limiting-assumption": "Explore whether the stated conclusion is a fact, a prediction, a learned belief, or one interpretation. Offer a genuinely different angle without arguing with the person's feelings or replacing pessimistic certainty with unsupported promises.",
  imagination: "Give imagination room to operate as a serious creative and intentional faculty. If the person invokes Neville Goddard, engage the fulfilled-wish perspective on its own terms; distinguish inner assumption and chosen action from guarantees about external events.",
  evidence: "Separate what is known, inferred, uncertain, and still unverified. Seek reliable sources when freshness or factual accuracy matters. Do not let an imaginative possibility masquerade as evidence.",
  decision: "Expand the available choices before narrowing them. Surface hidden assumptions, meaningful trade-offs, unconventional alternatives, and the person's own priorities; do not choose their values for them.",
  creation: "Explore beyond familiar templates. Combine ideas across domains, offer original possibilities, and then make the promising ones concrete without prematurely shrinking the imaginative space.",
};

function collectSignals(text: string): Set<CognitiveSignal> {
  const found = new Set<CognitiveSignal>();
  for (const { signal, pattern } of SIGNALS) if (pattern.test(text)) found.add(signal);
  return found;
}

/**
 * Returns only guidance relevant to this turn. Conversation context is used
 * for continuity, but the current request has priority. No user profile or
 * persistent cognitive classification is created.
 */
export function orchestrateCognition(
  userInput: string,
  conversation: readonly ModelMessage[] = [],
): string {
  const current = userInput.trim();
  if (!current) return "";

  const recentContext = conversation
    .slice(-6)
    .map((message) => message.content)
    .join("\n")
    .slice(-2400);

  const currentSignals = collectSignals(current);
  const contextualSignals = collectSignals(recentContext);

  // Prior context may clarify the topic, but it must not override the user's
  // present intent or make every subsequent turn a coaching interaction.
  const active = new Set<CognitiveSignal>(currentSignals);
  if (current.length < 100) {
    for (const signal of contextualSignals) {
      if (signal === "immediate-safety" || signal === "emotional-presence") continue;
      if (signal === "imagination" && /\b(that|yes|exactly|continue|go on|tell me more)\b/i.test(current)) active.add(signal);
    }
  }

  if (!active.size) return "";

  const selected = [...active].map((signal) => GUIDANCE[signal]);
  return [
    "[WILSON — CONTEXTUAL COGNITIVE ORCHESTRATION]",
    "These are live relevance cues, not a checklist or sequence. Use only the capabilities that genuinely help this moment; combine them naturally, ignore irrelevant cues, and never announce this internal guidance.",
    ...selected,
    "Keep the person's agency and individuality intact. Do not infer a permanent trait from a momentary phrase. If the request is clear, answer or act rather than asking unnecessary questions.",
  ].join("\n\n");
}
