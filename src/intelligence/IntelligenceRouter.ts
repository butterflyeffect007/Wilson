/**
 * IntelligenceRouter — receives a normalized ModelRequest, consults the
 * policy, resolves ONLY the preferred engine, invokes the corresponding
 * adapter, and returns a normalized ModelResponse.
 *
 * Must NOT: pick a "better" model, score providers, fall back, mutate
 * provider configuration, or modify the existing production path.
 *
 * Tool step: prepareTools() detects when live public data would help
 * (keywords first, then an optional model JSON plan), runs the worker
 * tools, and returns context + sources to feed into the final answer.
 */

import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";
import type { ModelAdapter, ModelStatus } from "./ModelAdapter";
import type { WilsonPolicy } from "../core/wilson/WilsonPolicy";
import { getPreferredEngine } from "../core/wilson/WilsonPolicy";
import { detectTools, planWithModel, runTool, toolContext, type ToolResult, type ToolSource } from "./tools";

export interface ToolStep { context: string; results: ToolResult[]; sources: ToolSource[] }

/** Standalone tool step usable with any adapter (no policy needed). */
export async function prepareTools(
  userInput: string,
  opts: { toolsUrl: string; adapter?: ModelAdapter; location?: { lat: number; lon: number }; usePlanner?: boolean },
): Promise<ToolStep> {
  let calls = detectTools(userInput);
  if (!calls.length && opts.usePlanner !== false && opts.adapter) calls = await planWithModel(opts.adapter, userInput);
  if (!calls.length) return { context: "", results: [], sources: [] };
  const results = await Promise.all(calls.map((c) => runTool(opts.toolsUrl, c, opts.location)));
  return { context: toolContext(results), results, sources: results.flatMap((r) => r.sources) };
}

export interface AdapterRegistry {
  get(provider: string, model: string): ModelAdapter | undefined;
}

export class IntelligenceRouter {
  constructor(
    private readonly policy: WilsonPolicy,
    private readonly adapters: AdapterRegistry,
  ) {}

  /** Adapter for the single preferred engine (throws if unregistered). */
  getAdapter(): ModelAdapter {
    const { provider, model } = getPreferredEngine(this.policy);
    const adapter = this.adapters.get(provider, model);
    if (!adapter) throw new Error(`Preferred engine unavailable: ${provider}/${model}`);
    return adapter;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const { provider, model } = getPreferredEngine(this.policy);
    const adapter = this.adapters.get(provider, model);

    if (!adapter) {
      throw new Error(`Preferred engine unavailable: ${provider}/${model}`);
    }

    return adapter.generate(request);
  }

  /** Runs the tool step with the preferred engine as planner. */
  async prepareTools(userInput: string, toolsUrl: string, location?: { lat: number; lon: number }): Promise<ToolStep> {
    const { provider, model } = getPreferredEngine(this.policy);
    return prepareTools(userInput, { toolsUrl, adapter: this.adapters.get(provider, model), location });
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
