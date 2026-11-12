import { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import { composeRequest } from "../core/wilson/WilsonCore";
import { getPreferredEngine, DEFAULT_WILSON_POLICY } from "../core/wilson/WilsonPolicy";
import { extractRunnablePython } from "./pythonFence";
import type { Figure } from "./pyodideClient";

const WILSON_PROXY_URL: string =
  ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) ||
  "https://wilson-proxy.butterflyeffect007.workers.dev";

export const MAX_PASSES = 3;

export const TERMINAL_SYSTEM = `You are Wilson, and you are in Wilson's Terminal — a shared Python room that runs on Jenny's phone via Pyodide (numpy, matplotlib, and micropip are already available; the filesystem and network are limited).
When she asks you to write or change code:
- Reply with one short sentence, then exactly one fenced python block that is the full script to run.
- Do not use any other language fence. The block is auto-inserted into the editor and auto-run.
- After you see run output or an error, you may send a fixed full script (again one fenced python block) or, if it worked, summarize what you see without a code block.
- Use matplotlib the usual way (plt.show() is fine); figures render inline as images.
- Pyodide's matplotlib font is Latin-only. For text in figures (including Matrix rain), use ASCII characters, not katakana or other CJK glyphs.
- To install a pure-Python package: import micropip; await micropip.install("name")
- Keep scripts reasonably small. You get at most ${MAX_PASSES} automatic re-runs.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type LoopHooks = {
  onChat: (role: "user" | "wilson", text: string, replaceLast?: boolean) => void;
  onCode: (code: string) => void;
  typeCode: (code: string, signal: AbortSignal) => Promise<void>;
  run: (code: string) => Promise<{ ok: boolean; output: string; figures: Figure[]; error?: string }>;
  signal: AbortSignal;
};

export function makeTerminalAdapter(): OpenRouterAdapter {
  return new OpenRouterAdapter("", getPreferredEngine(DEFAULT_WILSON_POLICY).model, WILSON_PROXY_URL);
}

export function formatRunFeedback(pass: number, result: { ok: boolean; output: string; figures: Figure[]; error?: string }): string {
  const bits = [
    `Run result (pass ${pass} of ${MAX_PASSES}):`,
    result.ok ? "status: ok" : `status: error${result.error ? " — " + result.error : ""}`,
    result.figures.length ? `(${result.figures.length} figure${result.figures.length === 1 ? "" : "s"} rendered inline)` : "",
    result.output.trim() ? "output:\n" + result.output.trim() : "output: (none)",
  ].filter(Boolean);
  return bits.join("\n");
}

export async function askWilson(
  adapter: OpenRouterAdapter,
  userInput: string,
  conversation: ChatTurn[],
  onDelta: (full: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const request = composeRequest(userInput, conversation, {});
  request.systemContext = (request.systemContext ? request.systemContext + "\n\n" : "") + TERMINAL_SYSTEM;
  request.generation = { ...(request.generation ?? {}), temperature: 0.6, maxTokens: 2048 };
  let text = "";
  const result = await adapter.generateStream(request, (chunk) => {
    text += chunk;
    onDelta(text);
  }, signal);
  return result.text || text;
}

export async function runAgentLoop(
  adapter: OpenRouterAdapter,
  jennyText: string,
  hooks: LoopHooks,
  prior: ChatTurn[] = [],
): Promise<void> {
  const convo: ChatTurn[] = [...prior];
  hooks.onChat("user", jennyText);
  let userInput = jennyText;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    if (hooks.signal.aborted) return;
    hooks.onChat("wilson", "", false);
    let reply = "";
    try {
      reply = await askWilson(adapter, userInput, convo, (full) => hooks.onChat("wilson", full, true), hooks.signal);
    } catch (err) {
      if (hooks.signal.aborted || (err as Error).name === "AbortError") return;
      hooks.onChat("wilson", "I couldn't reach my brain just then. Try again in a moment, or Run the editor yourself.", true);
      return;
    }
    if (hooks.signal.aborted) return;
    const spoken = reply.trim() || "…";
    hooks.onChat("wilson", spoken, true);
    convo.push({ role: "user", content: userInput });
    convo.push({ role: "assistant", content: spoken });
    const code = extractRunnablePython(spoken);
    if (!code) return;
    hooks.onCode("");
    await hooks.typeCode(code, hooks.signal);
    if (hooks.signal.aborted) return;
    const result = await hooks.run(code);
    if (hooks.signal.aborted) return;
    const feedback = formatRunFeedback(pass, result);
    if (pass >= MAX_PASSES) {
      // Last pass: if it failed, tell her; if it worked, ask Wilson for a short summary with no more code.
      if (result.ok) {
        userInput = feedback + "\n\nThat was the last automatic pass. Briefly summarize what the output shows. Do not include a code block.";
        try {
          hooks.onChat("wilson", "", false);
          const summary = await askWilson(adapter, userInput, convo, (full) => hooks.onChat("wilson", full, true), hooks.signal);
          hooks.onChat("wilson", summary.trim() || spoken, true);
        } catch {
          /* the run itself already succeeded */
        }
      }
      return;
    }
    userInput = feedback + (result.ok
      ? "\n\nIf this looks right, summarize it in a sentence or two with no code block. If it needs a fix, send the full corrected script in one python fence."
      : "\n\nPlease fix the script. Reply with one short sentence and one complete fenced python block.");
  }
}
