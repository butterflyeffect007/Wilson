/**
 * Titles and recaps must come from Groq's no-training "Private brain"
 * (via wilson-proxy, X-Wilson-Route: private). A Google/Gemini/Gemma
 * (or any other) model in the response is treated as a failure.
 */
export const PRIVATE_BRAIN_MODEL = "groq/openai/gpt-oss-120b";

const BLOCKED = /gemini|gemma|google|openrouter|nvidia|nemotron|cerebras|workers?\s*ai|@cf\//i;

export function isPrivateBrainModel(model: string | undefined | null): boolean {
  const m = String(model || "").trim().toLowerCase();
  if (!m || BLOCKED.test(m)) return false;
  return m === PRIVATE_BRAIN_MODEL || m.startsWith("groq/") || m === "openai/gpt-oss-120b";
}

export function isPrivateBrainResponse(r: {
  model?: string;
  metadata?: Record<string, unknown>;
} | null | undefined): boolean {
  if (!r) return false;
  const route = String(r.metadata?.wilsonRoute ?? "");
  if (route && route !== "private") return false;
  const model = String(r.metadata?.wilsonModel ?? r.model ?? "");
  return isPrivateBrainModel(model);
}
