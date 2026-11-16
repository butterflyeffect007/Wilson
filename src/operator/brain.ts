/**
 * Which model drives Operator mode.
 *  - Your own Groq key (Settings in the Operator room): private, Groq doesn't train on prompts.
 *  - Otherwise Wilson's usual brain through wilson-proxy, the same path chat uses
 *    (Operator adds no new place your words go).
 */
import { GroqAdapter } from "../intelligence/GroqAdapter";
import { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import { getPreferredEngine, DEFAULT_WILSON_POLICY } from "../core/wilson/WilsonPolicy";
import type { Brain } from "./loop";
import { WILSON_PROXY_URL, type OperatorSettings } from "./settings";

export function makeBrain(s: Pick<OperatorSettings, "groqKey" | "groqModel">, proxyUrl = WILSON_PROXY_URL): Brain {
  if (s.groqKey.trim()) {
    const g = new GroqAdapter(s.groqKey.trim(), s.groqModel || undefined);
    return { label: `Private brain (Groq · ${s.groqModel})`, noTraining: true, complete: async (req, signal) => (await g.generate(req, signal)).text };
  }
  const w = new OpenRouterAdapter("", getPreferredEngine(DEFAULT_WILSON_POLICY).model, proxyUrl);
  return {
    label: "Wilson's usual brain",
    noTraining: false,
    complete: async (req, signal) => {
      let text = "";
      const r = await w.generateStream(req, (c) => { text += c; }, signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return r.text || text;
    },
  };
}
