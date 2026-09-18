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
