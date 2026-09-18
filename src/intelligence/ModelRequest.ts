/**
 * Normalized, vendor-neutral request contract.
 *
 * Normalizes the information an intelligence engine needs without
 * coupling Wilson to a particular vendor.
 *
 * Proposal #1: types only. No provider-specific assumptions.
 */

export type ModelRole = "system" | "user" | "assistant" | "tool";

export interface ModelMessage {
  role: ModelRole;
  content: string;
}

export interface ModelGenerationSettings {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}

export interface ModelRequest {
  conversation?: ModelMessage[];
  systemContext?: string;
  memory?: unknown;
  userInput: string;
  tools?: unknown[];
  generation?: ModelGenerationSettings;
  metadata?: Record<string, unknown>;
}
