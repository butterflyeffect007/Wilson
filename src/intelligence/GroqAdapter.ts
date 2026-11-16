/**
 * GroqAdapter — ModelAdapter for Groq's OpenAI-compatible API, called straight
 * from the browser with the user's own key (kept on their device only).
 *
 * Why Groq: the free tier needs no card, and Groq's terms say it does not use
 * inputs or outputs to train models (https://console.groq.com/docs/your-data).
 * Turn on Zero Data Retention in Groq's Data Controls to stop even the
 * short-term abuse logs.
 */
import type { ModelAdapter, ModelCapabilities, ModelStatus } from "./ModelAdapter";
import type { ModelRequest } from "./ModelRequest";
import type { ModelResponse } from "./ModelResponse";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqAdapter implements ModelAdapter {
  constructor(private readonly apiKey: string, private readonly model: string = "openai/gpt-oss-120b") {
    if (!apiKey) throw new Error("Groq API key is required");
  }

  private messages(request: ModelRequest) {
    const out: { role: string; content: string }[] = [];
    if (request.systemContext) out.push({ role: "system", content: request.systemContext });
    for (const m of request.conversation ?? []) if (m.role === "user" || m.role === "assistant" || m.role === "system") out.push({ role: m.role, content: m.content });
    out.push({ role: "user", content: request.userInput });
    return out;
  }

  async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    const g = request.generation ?? {};
    const body: Record<string, unknown> = { model: (request.metadata?.model as string | undefined) || this.model, messages: this.messages(request), stream: false };
    if (g.temperature !== undefined) body.temperature = g.temperature;
    if (g.maxTokens !== undefined) body.max_completion_tokens = g.maxTokens;
    const r = await fetch(GROQ_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(body), signal });
    if (!r.ok) {
      let detail = ""; try { detail = (await r.json())?.error?.message ?? ""; } catch { /* ignore */ }
      throw new Error(`Groq ${r.status}${detail ? ` — ${detail}` : ""}`);
    }
    const d = await r.json();
    const c = d.choices?.[0];
    return { text: c?.message?.content ?? "", model: d.model ?? this.model, provider: "groq", finishReason: c?.finish_reason };
  }

  getCapabilities(): ModelCapabilities { return { streaming: false, toolCalling: false, vision: false }; }
  getStatus(): ModelStatus { return { available: Boolean(this.apiKey), provider: "groq", model: this.model }; }
}

export default GroqAdapter;
