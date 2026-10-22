/**
 * WilsonPolicy — the single preferred engine. App.tsx reads the model
 * from here so the registered adapter and the looked-up engine can
 * never drift apart again (that drift broke every chat on Oct 7).
 */
export interface WilsonPreferredEngine {
  provider: string;
  model: string;
}

export interface WilsonPolicy {
  preferredEngine: WilsonPreferredEngine;
}

export const DEFAULT_WILSON_POLICY: WilsonPolicy = {
  preferredEngine: {
    provider: "openrouter",
    // Same model family the original wilsonaibro used.
    model: "google/gemma-4-31b-it:free",
  },
};

export function getPreferredEngine(policy: WilsonPolicy = DEFAULT_WILSON_POLICY) {
  return policy.preferredEngine;
}
