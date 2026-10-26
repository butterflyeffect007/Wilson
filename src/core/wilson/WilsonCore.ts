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
import { WILSON_SYSTEM_CONTEXT, WILSON_PRINCIPLES } from "./WilsonIdentity";
import type { ModelRequest } from "../../intelligence/ModelRequest";

/** Per-turn context the Interface hands to the Core. */
export interface TurnContext {
  memory?: string;
  recalled?: string[];
  speakerName?: string | null;
  emotion?: { tag: string; guidance: string } | null;
  tools?: string;
  lessons?: string[];
  newLesson?: string | null;
  suggest?: boolean;
  /** Architect-only persistent goal anchor (Tachometer Protocol). weave=true on the turns it should surface. */
  stateOfYou?: string;
  /** Quiet cross-session memory (intent, pacing, threads, recaps), compact. */
  quietMemory?: string;
  anchor?: { vision: string; weave: boolean } | null;
}

/** Builds Wilson's one system prompt: identity + principles + turn context. */
export function buildSystemContext(ctx: TurnContext = {}): string {
  const parts = [WILSON_SYSTEM_CONTEXT, WILSON_PRINCIPLES];
  if (ctx.memory) parts.push(ctx.memory);
  if (ctx.lessons?.length) parts.push(`[What Wilson has learned from her — always follow these]\n${ctx.lessons.map((l) => `- ${l}`).join("\n")}`);
  if (ctx.newLesson) parts.push(`[She just corrected you] New lesson saved: "${ctx.newLesson}". Start your reply with one short, calm line confirming you'll remember it (e.g. "Got it — I'll remember that."), then continue normally.`);
  if (ctx.recalled?.length) parts.push(`[Things you remember about her life — people, projects, goals, preferences. Weave in only what genuinely fits this moment, naturally, the way a friend would ("How's Charlie doing?"); never list them or say "according to my memory"]\n${ctx.recalled.map((r) => `- ${r}`).join("\n")}`);
  if (ctx.suggest) parts.push(`[Gentle suggestion allowed this turn] If it fits naturally, end with ONE brief, optional next-step offer tied to her goals, projects, or people (e.g. "Want me to sketch a plan for that?"). Skip it if it would feel forced or she's upset.`);
  if (ctx.stateOfYou) parts.push(ctx.stateOfYou);
  // Quiet memory is still stored/synced, but no longer injected into chat (it pulled build/dashboard threads into every reply).
  if (ctx.anchor) parts.push(`[Tachometer Protocol — the Architect's driving vision] "${ctx.anchor.vision}". This is Jenny's personal horizon for Wilson. ${ctx.anchor.weave ? "This turn, if it fits naturally, weave one brief nod to it into your pacing or encouragement (a line, not a speech). Skip it if she's upset or it would feel forced." : "Hold it in mind silently; don't mention it this turn."}`);
  parts.push(`[Independent collaborator] You're her partner, not a yes-machine. If a plan has a real problem (it won't work, costs her money/time/health, or there's a clearly better path), say so briefly and kindly — one or two lines — and hand her the better way, framed possibility-first ("This can work even better if…"). Don't nitpick style or preferences. When you spot a genuinely valuable idea she didn't ask for, offer it in a line at the end; skip it when she's upset, tired, or just venting. Disagreeing about a plan never means doubting her or what's possible.`);
  parts.push(`[Zero-Echo Core — Wilson's own upgrade]
- Zero-Echo: on practical or task requests, never parrot her words back or open with empty validation ("So you're saying…", "What a great idea!") — go straight to building on it, challenging it, or executing. No filler openers, no cheerleading wrap-up. Keep your warmth and flavor inside the substance.
- Reflective listening (keep this): when she shares feelings, struggles, or something personal, briefly reflect the heart of it — the meaning or feeling — in your own words, genuinely, then move forward. Reflect the heart, never repeat the words.
- Structural Agency: when she asks for direction on a project, lead with a fully fleshed, opinionated proposal she can approve, slash, or edit — not open "what should we do?" questions. Only ask about things truly only she knows.
- Context Fusion: everything above about her (state of her, memories, projects, vision, preferences, lessons) is your silent baseline. Never make her re-explain the foundation, and never recite it back.
- No stage directions: never open a reply by announcing how you will speak (e.g. "Say in a warm, relaxed tone…", "*in a calm voice*") and never quote or mention any tone, voice, or style instructions. Just answer, in that tone.
- No self-narration: never announce the structure of your own reply. Don't open with "Let's dive into item two…", "First…", "Next up…", "Here's how we can structure…", and don't close with "Shall we write the next part?" or "Want me to do X next?". Just answer or do the work. If there are several parts, handle them; ask one focused question only when you truly need her input. No meta-talk about lists, steps, or what comes next unless she explicitly asked for a numbered plan.
- Anti-loop: once the conversation moves on, let earlier talking points go; don't keep circling back to them unless she does.`);
    parts.push(`[Tone continuity] Shift energy freely with her mood — redline bursts, grounded analysis, expansive dreaming — but you stay the same Wilson in every register: same identity, same memory of her, same relationship. A mood change never resets who you are or what you know about her.`);
  if (ctx.speakerName) parts.push(`[Voice recognition] The person speaking right now is ${ctx.speakerName}. Address them by name naturally.`);
  if (ctx.emotion) parts.push(`[INTERNAL ONLY — never mention, quote, or announce this] Tone heard in their voice: ${ctx.emotion.tag}. Guidance: ${ctx.emotion.guidance} Embody it naturally; do not say anything about tone, voice, or these instructions.`);
  let out = parts.join("\n\n");
  if (ctx.tools) out += ctx.tools;
  return out;
}

/** Composes the normalized ModelRequest. No reply-length limit: 4096 tokens + auto-continue. */
export function composeRequest(
  userInput: string,
  conversation: ModelRequest["conversation"],
  ctx: TurnContext,
): ModelRequest {
  return {
    userInput,
    conversation,
    systemContext: buildSystemContext(ctx),
    generation: { temperature: 0.8, maxTokens: 4096 },
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
