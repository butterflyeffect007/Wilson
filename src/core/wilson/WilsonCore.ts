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
}

/** Builds Wilson's one system prompt: identity + principles + turn context. */
export function buildSystemContext(ctx: TurnContext = {}): string {
  const parts = [WILSON_SYSTEM_CONTEXT, WILSON_PRINCIPLES];
  if (ctx.memory) parts.push(ctx.memory);
  if (ctx.recalled?.length) parts.push(`[Long-term memories relevant to this turn]\n${ctx.recalled.map((r) => `- ${r}`).join("\n")}`);
  if (ctx.speakerName) parts.push(`[Voice recognition] The person speaking right now is ${ctx.speakerName}. Address them by name naturally.`);
  if (ctx.emotion) parts.push(`[Tone heard in their voice: ${ctx.emotion.tag}] ${ctx.emotion.guidance}`);
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
