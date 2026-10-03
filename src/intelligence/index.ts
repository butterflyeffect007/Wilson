/**
 * Intelligence layer barrel export.
 *
 * Public surface: contracts (ModelAdapter, ModelRequest, ModelResponse),
 * the router, the registry, and the OpenRouter adapter.
 */

export type { ModelAdapter, ModelCapabilities, ModelStatus } from "./";
export type { ModelRequest, ModelMessage, ModelRole, ModelGenerationSettings } from "./";
export type { ModelResponse, ModelUsage } from "./";
export { IntelligenceRouter } from "./";
export type { AdapterRegistry as AdapterRegistryType } from "./";
export { AdapterRegistry } from "./";
export { OpenRouterAdapter } from "./";