/**
 * Intelligence layer barrel export.
 *
 * Public surface: contracts (ModelAdapter, ModelRequest, ModelResponse),
 * the router, the registry, and the OpenRouter adapter.
 */

export type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
export type { ModelRequest, ModelMessage, ModelRole, ModelGenerationSettings } from "./ModelRequest";
export type { ModelResponse, ModelUsage } from "./ModelResponse";
export { IntelligenceRouter } from "./IntelligenceRouter";
export type { AdapterRegistry as AdapterRegistryType } from "./IntelligenceRouter";
export { AdapterRegistry } from "./AdapterRegistry";
export { OpenRouterAdapter } from "./OpenRouterAdapter";
