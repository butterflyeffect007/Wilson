/**
 * Intelligence layer barrel export.
 *
 * Public surface: contracts, router, registry, OpenRouter, OmniRoute,
 * MCP gateway + server, and the one-call setup.
 */

export type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
export type { ModelRequest, ModelMessage, ModelRole, ModelGenerationSettings } from "./ModelRequest";
export type { ModelResponse, ModelUsage } from "./ModelResponse";
export { IntelligenceRouter } from "./IntelligenceRouter";
export type { AdapterRegistry as AdapterRegistryType } from "./IntelligenceRouter";
export { AdapterRegistry } from "./AdapterRegistry";
export { OpenRouterAdapter } from "./OpenRouterAdapter";
export { OmniRouteAdapter } from "./OmniRouteAdapter";
export type { OmniRouteAdapterOptions } from "./OmniRouteAdapter";
export { prepareTools } from "./IntelligenceRouter";
export type { ToolStep } from "./IntelligenceRouter";
export * from "./tools";
export * from "./mcp";
export { setupWilsonIntelligence } from "./setup";
export type { WilsonIntelligenceSetup, WilsonIntelligence } from "./setup";
