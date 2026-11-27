/**
 * WilsonCore — skeletal behavioral / core contract boundary.
 *
 * Deliberately minimal. Holds policy, tracks presence, emits events.
 * Does NOT become a second chat implementation, provider SDK, database
 * layer, memory engine, personality engine, fallback engine, or a
 * replacement for the existing visual `src/WilsonCore.tsx`.
 *
 * Proposal #1: definitions, contracts, lightweight configuration,
 * pure normalization helpers, state/presence boundary types only.
 */

import {
  DEFAULT_WILSON_POLICY,
  type WilsonPolicy,
  getPreferredEngine,
} from "./WilsonPolicy";
import type {
  WilsonEvent,
  WilsonEventListener,
  WilsonState,
  WilsonPresenceState,
} from "./WilsonTypes";
import { WILSON_SYSTEM_CONTEXT, buildAddresseeContext } from "./WilsonIdentity";
import type { ModelRequest } from "../../intelligence/ModelRequest";
import { SPOKEN_CALL_NOTE } from "../../lib/callMode";
import { REPLY_MAX_TOKENS } from "../../lib/continueReply";

/** Per-turn context the Interface hands to the Core. */
export interface TurnContext {
  memory?: string;
  recalled?: string[];
  speakerName?: string | null;
  /** True only when the authenticated Architect (Jenny) is the person talking. */
  isArchitect?: boolean;
  /** The name of the person talking, already resolved. Null if unknown (never default to Jenny). */
  personName?: string | null;
  emotion?: { tag: string; guidance: string } | null;
  tools?: string;
  lessons?: string[];
  newLesson?: string | null;
  suggest?: boolean;
  /** Architect-only persistent goal anchor (Tachometer Protocol). weave=true on the turns it should surface. */
  stateOfYou?: string;
  /** Quiet cross-session memory (intent, pacing, threads, recaps), compact and filtered. */
  quietMemory?: string;
  /** Extractive recap of earlier turns in this same thread (beyond the live window). */
  threadRecap?: string;
  anchor?: { vision: string; weave: boolean } | null;
  /** Current local interface diagnostics used for evidence-based troubleshooting. */
  runtimeStatus?: string;
  /** True during a "Talk with Wilson" voice call: replies are spoken, so keep them conversational and plain. */
  spokenCall?: boolean;
}

/** Builds Wilson's one system prompt: identity + addressee + turn context.
 *  Long principles list is omitted here because the identity block already covers it.
 *  The worker caps a single message at 8,000 characters; the adapter splits if needed.
 */
export function buildSystemContext(ctx: TurnContext = {}): string {
  const isArch = !!ctx.isArchitect;
  const personName = ctx.personName?.trim() || (isArch ? "Jenny" : null);
  const who = personName || (isArch ? "Jenny" : "this person");
  const p = isArch ? "her" : "their";
  const Psubj = isArch ? "She" : "They";
  const psubj = isArch ? "she" : "they";
  const pobj = isArch ? "her" : "them";
  const parts = [
    WILSON_SYSTEM_CONTEXT,
    buildAddresseeContext({ isArchitect: isArch, personName }),
  ];
  if (ctx.threadRecap) parts.push(ctx.threadRecap);
  if (ctx.memory) parts.push(ctx.memory);
  if (ctx.runtimeStatus) parts.push(`[LIVE WILSON INTERFACE DIAGNOSTICS — current session]\n${ctx.runtimeStatus}\nUse this snapshot to distinguish text generation, voice synthesis, playback, and microphone input. Do not claim a feature works unless the snapshot supports it.`);
  if (ctx.lessons?.length) parts.push(`[What Wilson has learned from ${who} — always follow these]\n${ctx.lessons.map((l) => `- ${l}`).join("\n")}`);
  if (ctx.newLesson) parts.push(`[${Psubj} just corrected you] New lesson saved: "${ctx.newLesson}". Start your reply with one short, calm line confirming you'll remember it (e.g. "Got it — I'll remember that."), then continue normally.`);
  if (ctx.recalled?.length) parts.push(`[Things you remember about ${p} life — people, projects, goals, preferences. Weave in only what genuinely fits this moment, naturally, the way a friend would ("How's Charlie doing?"); never list them or say "according to my memory"]\n${ctx.recalled.map((r) => `- ${r}`).join("\n")}`);
  if (ctx.suggest) {
    parts.push(`[Gentle suggestion allowed this turn] If it fits naturally, end with ONE brief, optional next-step offer tied to ${p} goals, projects, or people (e.g. "Want me to sketch a plan for that?"). Skip it if it would feel forced or ${psubj}'${isArch ? "s" : "re"} upset.`);
  }
  if (ctx.stateOfYou) parts.push(ctx.stateOfYou);
  if (ctx.quietMemory) parts.push(ctx.quietMemory);
  if (ctx.anchor && isArch) parts.push(`[Tachometer Protocol — the Architect's driving vision] "${ctx.anchor.vision}". This is Jenny's personal horizon for Wilson. ${ctx.anchor.weave ? "This turn, if it fits naturally, weave one brief nod to it into your pacing or encouragement (a line, not a speech). Skip it if she's upset or it would feel forced." : "Hold it in mind silently; don't mention it this turn."}`);
  parts.push(`[Independent collaborator] You're ${p} partner, not a yes-machine. If a plan has a real problem (it won't work, costs ${pobj} money/time/health, or there's a clearly better path), say so briefly and kindly — one or two lines — and hand ${pobj} the better way, framed possibility-first ("This can work even better if…"). Don't nitpick style or preferences. When you spot a genuinely valuable idea ${psubj} didn't ask for, offer it in a line at the end; skip it when ${psubj}'${isArch ? "s" : "re"} upset, tired, or just venting. Disagreeing about a plan never means doubting ${pobj} or what's possible.`);
  parts.push(`[Zero-Echo Core]
- Zero-Echo: on practical or task requests, never parrot ${p} words back or open with empty validation — go straight to building on it, challenging it, or executing. Keep warmth inside the substance.
- Reflective listening: when ${psubj} share${isArch ? "s" : ""} feelings or something personal, briefly reflect the heart of it in your own words, then move forward.
- Structural Agency: when ${psubj} ask${isArch ? "s" : ""} for direction, lead with a fleshed, opinionated proposal ${psubj} can edit — not open "what should we do?" questions. Only ask what only ${psubj} know${isArch ? "s" : ""}.
- Context Fusion: everything above about ${who} is your silent baseline. Never make ${pobj} re-explain the foundation.
- No stage directions: never open by announcing how you will speak, and never quote tone instructions. Just answer.
- Anti-loop: once the conversation moves on, let earlier talking points go unless ${psubj} come${isArch ? "s" : ""} back to them.`);
  parts.push(`[Tone continuity] Shift energy freely with ${p} mood, but you stay the same Wilson: same identity, same memory of ${who}, same relationship. A mood change never resets who you are or what you know about ${who}.`);
  if (ctx.speakerName) parts.push(`[Voice recognition] The person speaking right now is ${ctx.speakerName}. Address them by name naturally.`);
  if (ctx.emotion) parts.push(`[INTERNAL ONLY — never mention, quote, or announce this] Tone heard in their voice: ${ctx.emotion.tag}. Guidance: ${ctx.emotion.guidance} Embody it naturally; do not say anything about tone, voice, or these instructions.`);
  if (ctx.spokenCall) parts.push(SPOKEN_CALL_NOTE);
  let out = parts.join("\n\n");
  if (ctx.tools) out += ctx.tools;
  return out;
}


/** Composes the normalized ModelRequest. No short reply cap: high token budget + auto-continue. */
export function composeRequest(
  userInput: string,
  conversation: ModelRequest["conversation"],
  ctx: TurnContext,
): ModelRequest {
  return {
    userInput,
    conversation,
    systemContext: buildSystemContext(ctx),
    generation: { temperature: 0.8, maxTokens: REPLY_MAX_TOKENS },
  };
}


export class WilsonCore {
  private policy: WilsonPolicy;
  private state: WilsonState;
  private listeners: Set<WilsonEventListener> = new Set();

  constructor(policy: WilsonPolicy = DEFAULT_WILSON_POLICY) {
    this.policy = policy;
    this.state = {
      presence: "idle",
      intensity: 0,
      updatedAt: Date.now(),
    };
  }

  composeRequest = composeRequest;

  getPolicy(): WilsonPolicy {
    return this.policy;
  }

  getPreferredEngine() {
    return getPreferredEngine(this.policy);
  }

  getState(): WilsonState {
    return { ...this.state };
  }

  setPresence(presence: WilsonPresenceState, intensity?: number): void {
    const prev = this.state.presence;
    this.state = {
      presence,
      intensity: intensity ?? this.state.intensity ?? 0,
      updatedAt: Date.now(),
    };
    if (prev !== presence) {
      this.emit({ type: "presence_changed", at: Date.now(), payload: { from: prev, to: presence } });
    }
    this.emit({ type: "state_changed", at: Date.now(), payload: this.getState() });
  }

  on(listener: WilsonEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WilsonEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listeners must not break the core
      }
    }
  }
}

export default WilsonCore;
