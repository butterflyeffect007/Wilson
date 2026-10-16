/**
 * OpenRouterAdapter — ModelAdapter for OpenRouter (OpenAI-compatible).
 * Supports one-shot generate() and streaming generateStream() with abort.
 */
import type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export class OpenRouterError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

export interface StreamResult {
  text: string;
  finishReason?: string;
  model: string;
}

export class OpenRouterAdapter implements ModelAdapter {
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly url: string;

  /** If proxyUrl is given, requests go to the Wilson proxy (key held server-side). */
  constructor(apiKey: string, defaultModel: string = "google/gemma-4-31b-it:free", proxyUrl?: string) {
    if (!apiKey && !proxyUrl) throw new Error("OpenRouter API key is required");
    this.apiKey = apiKey;
    this.url = proxyUrl ? proxyUrl.replace(/\/$/, "") + "/v1/chat/completions" : OPENROUTER_URL;
    this.defaultModel = defaultModel;
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

  private headers(): Record<string, string> {
    if (this.url !== OPENROUTER_URL) {
      // Architect device: send the admin key so the worker can attach live app stats (verified server-side).
      let k = ""; try { if (localStorage.getItem("wilson_is_admin") === "1") k = localStorage.getItem("wilson_architect_key") || ""; } catch { /* ignore */ }
      return k ? { "Content-Type": "application/json", Authorization: `Bearer ${k}` } : { "Content-Type": "application/json" };
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://wilson.app",
      "X-Title": "Wilson",
    };
  }

  private async fail(response: Response): Promise<never> {
    let detail = "";
    try {
      const data = await response.json();
      detail = data?.error?.message ?? "";
    } catch {
      /* ignore */
    }
    throw new OpenRouterError(
      `OpenRouter ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
    );
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request, false)),
    });
    if (!response.ok) await this.fail(response);
    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      model: data.model ?? this.defaultModel,
      provider: "openrouter",
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

  /** Streams SSE deltas. Abort via signal; partial text is returned on abort. */
  async generateStream(
    request: ModelRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    let text = "";
    let finishReason: string | undefined;
    let model = this.defaultModel;

    const handleLine = (raw: string): boolean => {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line || line.startsWith(":") || !line.startsWith("data: ")) return false;
      const json = line.slice(6).trim();
      if (json === "[DONE]") return true;
      let parsed: any;
      try {
        parsed = JSON.parse(json);
      } catch {
        return false; // partial JSON — ignore
      }
      if (parsed?.error) {
        throw new OpenRouterError(parsed.error.message ?? "Stream error", Number(parsed.error.code) || 500);
      }
      if (parsed?.model) model = parsed.model;
      const choice = parsed?.choices?.[0];
      const delta: string | undefined = choice?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      return false;
    };

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.buildBody(request, true)),
        signal,
      });
      if (!response.ok) await this.fail(response);
      try { const m = response.headers.get("X-Wilson-Model"); if (m) localStorage.setItem("wilson_last_model", m); } catch { /* ignore */ }
      if (!response.body) throw new OpenRouterError("Empty response body", 502);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (handleLine(line)) {
            done = true;
            break;
          }
        }
      }
      if (!done && buffer.trim()) handleLine(buffer);
    } catch (e) {
      if ((e as Error).name === "AbortError") return { text, finishReason: "aborted", model };
      throw e;
    }
    return { text, finishReason, model };
  }

  getCapabilities(): ModelCapabilities {
    return { streaming: true, toolCalling: true, vision: true };
  }

  getStatus(): ModelStatus {
    return { available: Boolean(this.apiKey) || this.url !== OPENROUTER_URL, provider: "openrouter", model: this.defaultModel };
  }
}

export default OpenRouterAdapter;
