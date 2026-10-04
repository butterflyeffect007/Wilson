/**
 * WilsonPolicy — declares the single preferred configured engine.
 *
 * Proposal #1: policy-only. NO fallback. If the preferred engine is
 * unavailable, the boundary reports the unavailable state; it does not
 * silently switch to another provider.
 *
 * Default path: OpenRouter free models router (openrouter/free).
 */

export interface WilsonPreferredEngine {
  provider: string;
  model: string;
}

export interface WilsonPolicy {
  preferredEngine: WilsonPreferredEngine;
}

/**
 * Default policy: free OpenRouter router (no paid model required).
 */
export const DEFAULT_WILSON_POLICY: WilsonPolicy = {
  preferredEngine: {
    provider: "openrouter",
    model: "openrouter/free",
  },
};

export function getPreferredEngine(policy: WilsonPolicy = DEFAULT_WILSON_POLICY) {
  return policy.preferredEngine;
}
