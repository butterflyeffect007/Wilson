/**
 * IntelligenceRouter — receives a normalized ModelRequest, consults the
 * policy, resolves ONLY the preferred engine, invokes the corresponding
 * adapter, and returns a normalized ModelResponse.
 *
 * Must NOT: pick a "better" model, score providers, fall back, mutate
 * provider configuration, or modify the existing production path.
 *
 * Proposal #1: router only. Not wired into the live chat path.
 */

import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";
import type { ModelAdapter, ModelStatus } from "./ModelAdapter";
import type { WilsonPolicy } from "../core/wilson/WilsonPolicy";
import { getPreferredEngine } from "../core/wilson/WilsonPolicy";

export interface AdapterRegistry {
  get(provider: string, model: string): ModelAdapter | undefined;
}

export class IntelligenceRouter {
  constructor(
    private readonly policy: WilsonPolicy,
    private readonly adapters: AdapterRegistry,
  ) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const { provider, model } = getPreferredEngine(this.policy);
    const adapter = this.adapters.get(provider, model);

    if (!adapter) {
      throw new Error(`Preferred engine unavailable: ${provider}/${model}`);
    }

    return adapter.generate(request);
  }

  async getPreferredStatus(): Promise<ModelStatus> {
    const { provider, model } = getPreferredEngine(this.policy);
    const adapter = this.adapters.get(provider, model);

    if (!adapter) {
      return {
        available: false,
        provider,
        model,
        message: `Preferred engine unavailable: ${provider}/${model}`,
      };
    }

    if (adapter.getStatus) {
      return adapter.getStatus();
    }

    return { available: true, provider, model };
  }
}

export default IntelligenceRouter;
