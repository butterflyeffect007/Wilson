/**
 * OmniRouteAdapter — ModelAdapter for a local (or tunneled) OmniRoute gateway.
 *
 * OmniRoute is an OpenAI-compatible AI gateway that fronts 500+ models
 * and 290+ providers, with Combos for automatic fallback, quota-aware
 * routing, and optional token compression.
 *
 * Default endpoint: http://localhost:20128/v1/chat/completions
 * (matches OmniRoute's default port).
 *
 * Usage:
 *   const adapter = new OmniRouteAdapter({ baseUrl: "http://localhost:20128", apiKey: "your-omniroute-key" });
 *   registry.register("omniroute", "auto/best-coding", adapter);
 */

import type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export interface OmniRouteAdapterOptions {
  /** Base URL of the OmniRoute instance, no trailing slash. Default http://localhost:20128 */
  baseUrl?: string;
  /** API key created in the OmniRoute dashboard */
  apiKey?: string;
  /** Default model or combo alias, e.g. "auto/best-coding" or "auto/best-free" */
  defaultModel?: string;
}

export class OmniRouteAdapter implements ModelAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(opts: OmniRouteAdapterOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:20128").replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? "";
    this.defaultModel = opts.defaultModel ?? "auto/best-coding";
  }

  private url(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private buildBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
    const model = (request.metadata?.model as string | undefined) ?? this.defaultModel;
    const messages: ChatMsg[] = [];
    if (request.systemContext) messages.push({ role: "system", content: request.systemContext });
    for (const m of request.conversation ?? []) {
      if (m.role === "system" || m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: "user", content: request.userInput });

    const body: Record<string, unknown> = { model, messages, stream };
    const g = request.generation;
    if (g?.temperature !== undefined) body.temperature = g.temperature;
    if (g?.maxTokens !== undefined) body.max_tokens = g.maxTokens;
    if (g?.topP !== undefined) body.top_p = g.topP;
    return body;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await fetch(this.url(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request, false)),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OmniRoute ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      toolCalls: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : undefined,
      model: data.model ?? this.defaultModel,
      provider: "omniroute",
      finishReason: choice?.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      metadata: { id: data.id, created: data.created },
    };
  }

  getCapabilities(): ModelCapabilities {
    return { streaming: true, toolCalling: true, vision: true };
  }

  getStatus(): ModelStatus {
    return {
      available: true,
      provider: "omniroute",
      model: this.defaultModel,
      message: `Pointed at ${this.baseUrl}`,
    };
  }
}

export default OmniRouteAdapter;
