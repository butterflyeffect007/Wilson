/**
 * Normalized, vendor-neutral response contract.
 *
 * Proposal #1: types only.
 */

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

export interface ModelResponse {
  text: string;
  model: string;
  provider: string;
  finishReason?: string;
  usage?: ModelUsage;
  toolCalls?: unknown[];
  metadata?: Record<string, unknown>;
}
