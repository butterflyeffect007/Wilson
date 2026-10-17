/**
 * Full Wilson intelligence setup: OmniRoute gateway + MCP translation layer.
 *
 * One place to turn both layers on. Existing OpenRouter path stays untouched.
 *
 * Usage (in App.tsx or a bootstrap):
 *
 *   import { setupWilsonIntelligence } from "./intelligence/setup";
 *   const { registry, mcp } = await setupWilsonIntelligence({
 *     policy: { preferredEngine: { provider: "omniroute", model: "auto/best-coding" } },
 *     omniroute: { apiKey: "..." },
 *     mcp: [{ id: "wilson", url: "http://localhost:3001/mcp" }],
 *   });
 */

import { AdapterRegistry } from "./AdapterRegistry";
import { OmniRouteAdapter, type OmniRouteAdapterOptions } from "./OmniRouteAdapter";
import { McpGateway, type McpServerConfig } from "./mcp";
import type { WilsonPolicy } from "../core/wilson/WilsonPolicy";
import { DEFAULT_WILSON_POLICY } from "../core/wilson/WilsonPolicy";

export interface WilsonIntelligenceSetup {
  policy?: WilsonPolicy;
  omniroute?: OmniRouteAdapterOptions;
  mcp?: McpServerConfig[];
}

export interface WilsonIntelligence {
  registry: AdapterRegistry;
  policy: WilsonPolicy;
  mcp?: McpGateway;
}

/** Registers OmniRoute (if configured) and optionally connects MCP servers. */
export async function setupWilsonIntelligence(
  opts: WilsonIntelligenceSetup = {},
): Promise<WilsonIntelligence> {
  const registry = new AdapterRegistry();
  const policy = opts.policy ?? DEFAULT_WILSON_POLICY;

  // Gateway layer
  if (opts.omniroute) {
    const adapter = new OmniRouteAdapter(opts.omniroute);
    const model = opts.omniroute.defaultModel ?? "auto/best-coding";
    registry.register("omniroute", model, adapter);
    registry.register("omniroute", "auto/best-coding", adapter);
    registry.register("omniroute", "auto/best-free", adapter);
    registry.register("omniroute", "auto/best", adapter);
  }

  // Translation layer
  let mcp: McpGateway | undefined;
  if (opts.mcp?.length) {
    mcp = new McpGateway(opts.mcp);
    await mcp.connect();
  }

  return { registry, policy, mcp };
}

export default setupWilsonIntelligence;
