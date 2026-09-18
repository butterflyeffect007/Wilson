/**
 * ModelAdapter — abstracts a model provider without implementing
 * provider selection policy.
 *
 * Required: generate.
 * Optional: stream, getCapabilities, getStatus.
 *
 * Proposal #1: contract only. No concrete adapters implemented.
 */

import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";

export interface ModelCapabilities {
  streaming?: boolean;
  toolCalling?: boolean;
  vision?: boolean;
  [key: string]: unknown;
}

export interface ModelStatus {
  available: boolean;
  provider: string;
  model: string;
  message?: string;
}

export interface ModelAdapter {
  generate(request: ModelRequest): Promise<ModelResponse>;

  stream?(request: ModelRequest, onChunk: (chunk: string) => void): Promise<void>;

  getCapabilities?(): ModelCapabilities;

  getStatus?(): Promise<ModelStatus> | ModelStatus;
}
