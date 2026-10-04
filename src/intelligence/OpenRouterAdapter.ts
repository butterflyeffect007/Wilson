/**
 * OpenRouterAdapter — concrete ModelAdapter for OpenRouter.
 *
 * Uses the OpenAI-compatible chat completions endpoint.
 * API key comes from VITE_OPENROUTER_KEY (Vite env variable).
 *
 * Implements the ModelAdapter contract from ./ModelAdapter.ts.
 * No provider selection policy here — that lives in WilsonPolicy.
 */

import type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterAdapter implements ModelAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = "openrouter/free",
  ) {
    if (!apiKey) {
      throw new Error("OpenRouter API key is required");
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const model = (request.metadata?.model as string) ?? this.defaultModel;

    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    } | null> = [];

    if (request.systemContext) {
      messages.push({ role: "system", content: request.systemContext });
    }

    if (request.conversation) {
      for (const msg of request.conversation) {
        if (msg.role === "system" || msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    messages.push({ role: "user", content: request.userInput });

    const body: Record<string, unknown> = {
      model,
      messages,
    };

    if (request.generation) {
      if (request.generation.temperature !== undefined) {
        body.temperature = request.generation.temperature;
      }
      if (request.generation.maxTokens !== undefined) {
        body.max_tokens = request.generation.maxTokens;
      }
      if (request.generation.topP !== undefined) {
        body.top_p = request.generation.topP;
      }
    }

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": window.location?.origin ?? "https://wilson.app",
        "X-Title": "Wilson",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `OpenRouter request failed: ${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ""}`,
      );
    }

    const data = await response.json();

    const choice = data.choices?.[0];
    const text: string = choice?.message?.content ?? "";

    return {
      text,
      model: data.model ?? model,
      provider: "openrouter",
      finishReason: choice?.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      metadata: {
        id: data.id,
        created: data.created,
      },
    };
  }

  getCapabilities(): ModelCapabilities {
    return {
      streaming: true,
      toolCalling: true,
      vision: true,
    };
  }

  getStatus(): ModelStatus {
    return {
      available: Boolean(this.apiKey),
      provider: "openrouter",
      model: this.defaultModel,
    };
  }
}

export default OpenRouterAdapter;
