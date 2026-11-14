/**
 * Load and time WebLLM packs, or the existing rented Wilson path.
 * Never reads HF_TOKEN or any other secret. Public MLC packs only.
 * The chat test uses Jenny's Wilson identity text as-is — no extra policies.
 */
import { WILSON_SYSTEM_CONTEXT, WILSON_PRINCIPLES } from "../core/wilson/WilsonIdentity";
import { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import { DEFAULT_WILSON_POLICY, getPreferredEngine } from "../core/wilson/WilsonPolicy";
import type { OmniCaps } from "./caps";
import { beginLoadWatch, clearTierCrash, endLoadWatch, markTierCrash, type OmniTier, type OmniTierId } from "./tiers";

export const WILSON_BRAIN_PROMPT = `${WILSON_SYSTEM_CONTEXT}\n\n${WILSON_PRINCIPLES}`;
export const PERSONA_TEST_PROMPT = "In one or two sentences, who are you?";

export type TestProgress = { text: string; progress: number };

export type OmniTestResult = {
  ok: boolean;
  tierId: OmniTierId;
  modelId: string;
  loadMs: number | null;
  tokensPerSec: number | null;
  completionTokens: number | null;
  reply: string;
  error: string | null;
};

type WebLLMModule = typeof import("@mlc-ai/web-llm");
type MLCEngine = import("@mlc-ai/web-llm").MLCEngine;
let webllmMod: WebLLMModule | null = null;
let loadedEngine: { tierId: OmniTierId; modelId: string; engine: MLCEngine } | null = null;

async function loadWebllm(): Promise<WebLLMModule> {
  if (!webllmMod) webllmMod = await import("@mlc-ai/web-llm");
  return webllmMod;
}

function catalogIds(mod: WebLLMModule): string[] {
  const list = (mod.prebuiltAppConfig?.model_list || []) as { model_id?: string }[];
  return list.map((m) => m.model_id).filter((id): id is string => !!id);
}

export function resolveWebllmModelId(tier: OmniTier, caps: OmniCaps, available: string[]): string | null {
  const preferred = caps.shaderF16 ? [...tier.modelIds, ...tier.modelIdsNoF16] : [...tier.modelIdsNoF16, ...tier.modelIds];
  const hit = preferred.find((id) => available.includes(id));
  if (hit) return hit;
  // Catalog may lag official HF packs (Gemma 4 E2B). Still try the first preferred id.
  return preferred[0] || null;
}

export async function listWebllmCatalog(): Promise<string[]> {
  try {
    const mod = await loadWebllm();
    return catalogIds(mod);
  } catch {
    return [];
  }
}

async function unloadCurrent(): Promise<void> {
  const cur = loadedEngine;
  loadedEngine = null;
  if (cur?.engine?.unload) {
    try { await cur.engine.unload(); } catch { /* ignore */ }
  }
}

function countTokensRough(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  // English-ish approximation when the runtime does not return usage.
  return Math.max(1, Math.round(parts.length * 1.3));
}

const OFFICIAL_HF: Record<string, string> = {
  "gemma-4-E2B-it-q4f16_1-MLC": "https://huggingface.co/mlc-ai/gemma-4-E2B-it-q4f16_1-MLC",
  "gemma-4-E2B-it-q4f32_1-MLC": "https://huggingface.co/mlc-ai/gemma-4-E2B-it-q4f32_1-MLC",
  "Qwen3-0.6B-q4f16_1-MLC": "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC": "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
  "SmolLM2-135M-Instruct-q0f16-MLC": "https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC",
  "SmolLM2-135M-Instruct-q4f16_1-MLC": "https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q4f16_1-MLC",
};

async function createEngine(mod: WebLLMModule, modelId: string, onProgress: (p: TestProgress) => void) {
  const available = catalogIds(mod);
  const inCatalog = available.includes(modelId);
  const hf = OFFICIAL_HF[modelId];
  const appConfig = inCatalog
    ? undefined
    : hf
      ? {
          model_list: [{
            model: hf,
            model_id: modelId,
            model_lib: `${hf}/resolve/main/libs/${modelId}-webgpu.wasm`,
            required_features: modelId.includes("f16") ? ["shader-f16"] : [],
          }],
        }
      : undefined;
  return mod.CreateMLCEngine(modelId, {
    initProgressCallback: (r: { text?: string; progress?: number }) => {
      onProgress({ text: r.text || "Loading…", progress: typeof r.progress === "number" ? r.progress : 0 });
    },
    ...(appConfig ? { appConfig } : {}),
  });
}

async function chatWithEngine(engine: MLCEngine, userText: string, opts?: { system?: string; maxTokens?: number; temperature?: number }): Promise<{ reply: string; tokens: number; ms: number }> {
  const t0 = performance.now();
  const res = await engine.chat.completions.create({
    messages: [
      { role: "system", content: opts?.system || WILSON_BRAIN_PROMPT },
      { role: "user", content: userText },
    ],
    max_tokens: opts?.maxTokens ?? 120,
    temperature: opts?.temperature ?? 0.8,
  }) as {
    choices?: { message?: { content?: string } }[];
    usage?: { completion_tokens?: number };
  };
  const ms = performance.now() - t0;
  const reply = String(res.choices?.[0]?.message?.content || "").trim();
  const tokens = res.usage?.completion_tokens || countTokensRough(reply);
  return { reply, tokens, ms };
}

export async function runTierTest(
  tier: OmniTier,
  caps: OmniCaps,
  onProgress: (p: TestProgress) => void,
  prompt = PERSONA_TEST_PROMPT,
): Promise<OmniTestResult> {
  const fail = (error: string, extra: Partial<OmniTestResult> = {}): OmniTestResult => {
    endLoadWatch();
    markTierCrash(tier.id, error);
    return { ok: false, tierId: tier.id, modelId: extra.modelId || "", loadMs: extra.loadMs ?? null, tokensPerSec: null, completionTokens: null, reply: "", error };
  };

  if (tier.kind === "rented") {
    onProgress({ text: "Talking to the rented Wilson brain…", progress: 0.2 });
    const t0 = performance.now();
    try {
      const model = getPreferredEngine(DEFAULT_WILSON_POLICY).model;
      const proxy = ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) || "https://wilson-proxy.butterflyeffect007.workers.dev";
      const ad = new OpenRouterAdapter("", model, proxy);
      const res = await ad.generate({
        systemContext: WILSON_BRAIN_PROMPT,
        userInput: prompt,
        generation: { maxTokens: 120, temperature: 0.8 },
      });
      const ms = performance.now() - t0;
      const reply = (res.text || "").trim();
      const tokens = res.usage?.completionTokens || countTokensRough(reply);
      endLoadWatch();
      clearTierCrash(tier.id);
      return {
        ok: !!reply,
        tierId: tier.id,
        modelId: res.model || model,
        loadMs: Math.round(ms),
        tokensPerSec: tokens && ms > 0 ? Math.round((tokens / ms) * 10000) / 10 : null,
        completionTokens: tokens,
        reply,
        error: reply ? null : "The rented brain returned an empty reply.",
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "The rented brain could not be reached.");
    }
  }

  if (!caps.webgpu) return fail("WebGPU is required for this pack.");

  beginLoadWatch(tier.id);
  const tLoad = performance.now();
  try {
    onProgress({ text: "Loading the WebLLM runtime…", progress: 0.02 });
    const mod = await loadWebllm();
    const available = catalogIds(mod);
    const modelId = resolveWebllmModelId(tier, caps, available);
    if (!modelId) return fail("No matching WebLLM pack id was found for this tier.");
    onProgress({ text: `Downloading ${modelId}…`, progress: 0.05 });
    await unloadCurrent();
    const engine = await createEngine(mod, modelId, onProgress);
    const loadMs = Math.round(performance.now() - tLoad);
    loadedEngine = { tierId: tier.id, modelId, engine };
    onProgress({ text: "Running the Wilson persona test…", progress: 0.95 });
    const chat = await chatWithEngine(engine, prompt);
    endLoadWatch();
    clearTierCrash(tier.id);
    return {
      ok: !!chat.reply,
      tierId: tier.id,
      modelId,
      loadMs,
      tokensPerSec: chat.ms > 0 ? Math.round((chat.tokens / chat.ms) * 10000) / 10 : null,
      completionTokens: chat.tokens,
      reply: chat.reply,
      error: chat.reply ? null : "The pack loaded but returned an empty reply.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "This pack failed to load.";
    return fail(message);
  }
}

export async function followUpChat(userText: string): Promise<{ reply: string; tokensPerSec: number | null } | { error: string }> {
  if (!loadedEngine) return { error: "Load a local pack first, then you can chat with it here." };
  try {
    const chat = await chatWithEngine(loadedEngine.engine, userText);
    return {
      reply: chat.reply || "",
      tokensPerSec: chat.ms > 0 ? Math.round((chat.tokens / chat.ms) * 10000) / 10 : null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Chat failed." };
  }
}


export type ActiveBrain = "on-device" | "rented";

function proxyUrl(): string {
  return ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) || "https://wilson-proxy.butterflyeffect007.workers.dev";
}

/** Answer with the loaded on-device pack when present; otherwise the rented path. Escalates if the local pack fails and allowEscalate is true. */
export async function generateWithActiveBrain(opts: {
  userText: string;
  systemContext?: string;
  preferLocal?: boolean;
  allowEscalate?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ reply: string; brain: ActiveBrain; modelId: string; escalated: boolean; error?: string }> {
  const system = opts.systemContext || WILSON_BRAIN_PROMPT;
  const maxTokens = opts.maxTokens ?? 280;
  const temperature = opts.temperature ?? 0.8;
  const pack = loadedEngine;
  const wantLocal = opts.preferLocal !== false && !!pack;
  if (wantLocal && pack) {
    try {
      const chat = await chatWithEngine(pack.engine, opts.userText, { system, maxTokens, temperature });
      if (chat.reply) return { reply: chat.reply, brain: "on-device", modelId: pack.modelId, escalated: false };
      if (!opts.allowEscalate) return { reply: "", brain: "on-device", modelId: pack.modelId, escalated: false, error: "Empty reply from the on-device pack." };
    } catch (err) {
      if (!opts.allowEscalate) {
        return { reply: "", brain: "on-device", modelId: pack.modelId, escalated: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  try {
    const model = getPreferredEngine(DEFAULT_WILSON_POLICY).model;
    const ad = new OpenRouterAdapter("", model, proxyUrl());
    const res = await ad.generate({
      systemContext: system,
      userInput: opts.userText,
      generation: { maxTokens, temperature },
    });
    const reply = (res.text || "").trim();
    return {
      reply,
      brain: "rented",
      modelId: res.model || model,
      escalated: wantLocal,
      error: reply ? undefined : "The rented brain returned an empty reply.",
    };
  } catch (err) {
    return {
      reply: "",
      brain: "rented",
      modelId: "",
      escalated: wantLocal,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function loadedPack(): { tierId: OmniTierId; modelId: string } | null {
  return loadedEngine ? { tierId: loadedEngine.tierId, modelId: loadedEngine.modelId } : null;
}
