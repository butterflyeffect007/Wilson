/**
 * OpenRouterAdapter — ModelAdapter for OpenRouter (OpenAI-compatible).
 * Supports one-shot generate() and streaming generateStream() with abort.
 */
import type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";
import { getToken } from "../accounts/store";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export class OpenRouterError extends Error {
  readonly status: number;
  /** Set by the Wilson worker, e.g. "wilson_cap" when this visitor hit the daily usage cap. */
  readonly code?: string;
  /** The worker's own friendly sentence, when it sent one. */
  readonly friendly?: string;
  constructor(message: string, status: number, code?: string, friendly?: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.code = code;
    this.friendly = friendly;
  }
}

export interface StreamResult {
  text: string;
  finishReason?: string;
  model: string;
  /** Worker set X-Wilson-Degraded when a backup brain answered. */
  degraded?: string | null;
}


function rememberWilsonHeaders(response: Response): string | null {
  let degraded: string | null = null;
  try {
    const m = response.headers.get("X-Wilson-Model");
    if (m) localStorage.setItem("wilson_last_model", m);
    const d = response.headers.get("X-Wilson-Degraded");
    if (d) localStorage.setItem("wilson_last_degraded", d);
    else localStorage.removeItem("wilson_last_degraded");
    degraded = d;
  } catch { /* ignore */ }
  return degraded;
}


import { splitSystemContext } from "../lib/systemSplit";
export { splitSystemContext } from "../lib/systemSplit";

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
    for (const chunk of splitSystemContext(request.systemContext)) messages.push({ role: "system", content: chunk });
    for (const m of request.conversation ?? []) {
      if (m.role === "system" || m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: "user", content: request.userInput });

    const body: Record<string, unknown> = { model, messages, stream };
    // Background task marker for the Wilson proxy (it strips it; no stats/extra context on those calls).
    const task = request.metadata?.task;
    if (typeof task === "string" && this.url !== OPENROUTER_URL) body.wilson_task = task;
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
      const hd: Record<string, string> = { "Content-Type": "application/json" };
      if (k) hd.Authorization = `Bearer ${k}`;
      // Signed-in account: lets the worker count active people (no message content is stored for this).
      const sess = getToken(); if (sess) hd["X-Wilson-Session"] = sess;
      return hd;
    }
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://wilson.app",
      "X-Title": "Wilson",
    };
  }

  private async fail(response: Response): Promise<never> {
    let detail = "", code: string | undefined;
    try {
      const data = await response.json();
      detail = data?.error?.message ?? "";
      code = typeof data?.error?.code === "string" ? data.error.code : undefined;
    } catch {
      /* ignore */
    }
    throw new OpenRouterError(
      `OpenRouter ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
      code,
      code === "wilson_cap" ? detail : undefined,
    );
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(request, false)),
    });
    if (!response.ok) await this.fail(response);
    rememberWilsonHeaders(response);
    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      toolCalls: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : undefined,
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
    let degraded: string | null = null;

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
        // Mid-stream upstream error (e.g. Gemini UNAVAILABLE): keep the words we have
        // and mark the reply truncated so the app can auto-continue.
        if (text) { finishReason = finishReason || "length"; return true; }
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
      degraded = rememberWilsonHeaders(response);
      if (!response.body) throw new OpenRouterError("Empty response body", 502);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { done: rDone, value } = await reader.read();
        if (rDone) {
          buffer += decoder.decode();
          break;
        }
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
      if ((e as Error).name === "AbortError") return { text, finishReason: "aborted", model, degraded };
      throw e;
    }
    return { text, finishReason, model, degraded };
  }

  getCapabilities(): ModelCapabilities {
    return { streaming: true, toolCalling: true, vision: true };
  }

  getStatus(): ModelStatus {
    return { available: Boolean(this.apiKey) || this.url !== OPENROUTER_URL, provider: "openrouter", model: this.defaultModel };
  }
}

export default OpenRouterAdapter;
