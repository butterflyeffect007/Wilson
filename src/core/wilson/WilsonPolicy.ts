/**
 * WilsonPolicy — declares the single preferred configured engine.
 *
 * Proposal #1: policy-only. NO fallback. If the preferred engine is
 * unavailable, the boundary reports the unavailable state; it does not
 * silently switch to another provider.
 *
 * The preferred engine mirrors the currently configured live path
 * (OpenRouter -> openai/gpt-4o) without redirecting that path.
 */

export interface WilsonPreferredEngine {
  provider: string;
  model: string;
}

export interface WilsonPolicy {
  preferredEngine: WilsonPreferredEngine;
}

/**
 * Default policy for Proposal #1.
 * Matches the existing OpenRouter integration's configured model.
 */
export const DEFAULT_WILSON_POLICY: WilsonPolicy = {
  preferredEngine: {
    provider: "openrouter",
    model: "openai/gpt-4o",
  },
};

export function getPreferredEngine(policy: WilsonPolicy = DEFAULT_WILSON_POLICY) {
  return policy.preferredEngine;
}
