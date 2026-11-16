/**
 * Operator settings. Kept on this device only (localStorage), never in code.
 *
 * - groqKey / groqModel: optional "private brain" (Groq free tier: no card,
 *   does not train on your prompts). Without it, Operator uses Wilson's usual
 *   brain through wilson-proxy (the same path the chat already uses).
 * - browserUrl / browserToken: optional live browser (workers/operator-browser,
 *   Cloudflare Browser Run on the Workers Free plan). Without it, Operator can
 *   still search, open, read and follow links; it just can't type into pages.
 */
export type OperatorSettings = {
  groqKey: string;
  groqModel: string;
  browserUrl: string;
  browserToken: string;
  snapshots: boolean;
};

const KEY = "wilson_operator_settings";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

function env(name: string): string {
  try { return String(((import.meta as any).env?.[name] as string | undefined) ?? "").trim(); } catch { return ""; }
}

export const WILSON_PROXY_URL: string = env("VITE_WILSON_PROXY_URL") || "https://wilson-proxy.butterflyeffect007.workers.dev";

export function loadOperatorSettings(): OperatorSettings {
  let s: Partial<OperatorSettings> = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { s = {}; }
  return {
    groqKey: String(s.groqKey || ""),
    groqModel: String(s.groqModel || DEFAULT_GROQ_MODEL),
    // The browser URL is not a secret, so a build may preset it; the token never ships in the build.
    browserUrl: String(s.browserUrl || env("VITE_OPERATOR_BROWSER_URL") || ""),
    browserToken: String(s.browserToken || ""),
    snapshots: s.snapshots !== false,
  };
}

export function saveOperatorSettings(s: OperatorSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function clearOperatorKeys(): void {
  const s = loadOperatorSettings();
  saveOperatorSettings({ ...s, groqKey: "", browserToken: "" });
}
