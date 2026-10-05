/**
 * WilsonPolicy — declares the single preferred configured engine.
 *
 * Proposal #1: policy-only. NO fallback. If the preferred engine is
 * unavailable, the boundary reports the unavailable state; it does not
 * silently switch to another provider.
 *
 * Default path: a specific reliable free model (not the random free router).
 */

export interface WilsonPreferredEngine {
  provider: string;
  model: string;
}

export interface WilsonPolicy {
  preferredEngine: WilsonPreferredEngine;
}

/**
 * Default policy: lock to one solid free model so replies stay consistent.
 * The openrouter/free router was randomly picking overloaded models that
 * frequently returned empty text.
 */
export const DEFAULT_WILSON_POLICY: WilsonPolicy = {
  preferredEngine: {
    provider: "openrouter",
    model: "qwen/qwen3.8-27b:free",
  },
};

export function getPreferredEngine(policy: WilsonPolicy = DEFAULT_WILSON_POLICY) {
  return policy.preferredEngine;
}
