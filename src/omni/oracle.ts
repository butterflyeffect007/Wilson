/**
 * Omni Oracle tool loop.
 * Regex routing is the floor; constrained JSON planning can add tools up to a cap.
 * On-device brain first when a pack is loaded; rented fallback; escalate if the loop fails.
 * Secrets stay on the worker. Personality comes only from WILSON_BRAIN_PROMPT.
 */
import { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import type { ModelAdapter } from "../intelligence/ModelAdapter";
import type { ModelRequest, ModelResponse } from "../intelligence";
import { detectTools, planWithModel, runTool, toolContext, TOOL_DESCRIPTIONS, type ToolCall, type ToolName, type ToolResult, type ToolSource } from "../intelligence/tools";
import { DEFAULT_WILSON_POLICY, getPreferredEngine } from "../core/wilson/WilsonPolicy";
import { isE2EOmni } from "./access";
import { generateWithActiveBrain, loadedPack, WILSON_BRAIN_PROMPT, type ActiveBrain } from "./engine";
import { HARM_STOP_REPLY, seriousHarmStop } from "./harmStop";
import {
  detectOracleTools,
  oraclePlannerCatalog,
  oracleToolContext,
  runOracleTools,
  type OracleToolCall,
  type OracleToolName,
  type OracleToolResult,
} from "./oracleTools";

export const MAX_TOOLS_PER_TURN = 4;

export type OracleCall = { name: string; query?: string };

export type OracleTurn = {
  reply: string;
  brain: ActiveBrain | "stopped" | "fixture";
  modelId: string;
  escalated: boolean;
  stopped: boolean;
  planner: "regex" | "regex+json" | "none" | "fixture";
  worker: ToolResult[];
  oracle: OracleToolResult[];
  sources: ToolSource[];
  used: { name: string; ok: boolean }[];
  error?: string;
};

export type OracleOpts = {
  toolsUrl?: string;
  architect: boolean;
  speakerId?: string;
  image?: Blob | null;
  location?: { lat: number; lon: number };
  /** When true, skip the e2e fixture even on localhost. */
  live?: boolean;
};

const PROXY = ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) || "https://wilson-proxy.butterflyeffect007.workers.dev";

function rentedAdapter(): OpenRouterAdapter {
  const model = getPreferredEngine(DEFAULT_WILSON_POLICY).model;
  return new OpenRouterAdapter("", model, PROXY);
}

/** Screenshot / Playwright fixture. Clearly labeled example data — not a live hunt. */
export const EXAMPLE_ORACLE_QUESTION =
  "Hunt jobs and any Sunflower grants, then remember that I live in Austin.";

export const EXAMPLE_ORACLE: OracleTurn = {
  reply: "Example loop only — not live results. Jobs hunt and the Sunflower / mesh lane came back with sample cards (Austin rent help, a remote prompt-engineer gig, an open-source mesh grant). I saved “I live in Austin” to on-device memory. Open the official pages yourself; I don't invent amounts or apply for you.",
  brain: "fixture",
  modelId: "example-fixture",
  escalated: false,
  stopped: false,
  planner: "fixture",
  worker: [],
  oracle: [
    { name: "jobs_hunt", ok: true, text: "Jobs hunt — Example data for preview only. This is not a live Money Hunt." },
    { name: "sunflower", ok: true, text: "Sunflower / mesh lane — Example data for preview only. This is not a live Money Hunt." },
    { name: "memory_save", ok: true, text: "Saved to local memory: Hunt jobs and any Sunflower grants, then remember that I live in Austin." },
  ],
  sources: [],
  used: [
    { name: "jobs_hunt", ok: true },
    { name: "sunflower", ok: true },
    { name: "memory_save", ok: true },
  ],
};

function capCalls<T>(items: T[], max = MAX_TOOLS_PER_TURN): T[] {
  return items.slice(0, max);
}

function oracleCallToQuery(c: OracleToolCall): OracleToolCall {
  return { name: c.name, query: (c.query || "").slice(0, 240) };
}

async function planExtra(
  adapter: ModelAdapter,
  message: string,
  architect: boolean,
  already: Set<string>,
  room: number,
): Promise<{ worker: ToolCall[]; oracle: OracleToolCall[] }> {
  if (room <= 0) return { worker: [], oracle: [] };
  const workerList = Object.entries(TOOL_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const oracleList = Object.entries(oraclePlannerCatalog(architect)).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  try {
    const r = await adapter.generate({
      systemContext: `You are a tool router, not the assistant. Decide which tools would help answer the user. Worker tools:\n${workerList}\nOn-device / app tools:\n${oracleList}\nReply with ONLY JSON: {"tools":[{"name":"<tool>","params":{"q":"..."}}]} (max ${room}) or {"tools":[]}.`,
      userInput: message,
      generation: { temperature: 0, maxTokens: 180 },
      metadata: { task: "omni-router" },
    });
    const m = r.text.match(/\{[\s\S]*\}/);
    let raw: { name?: string; params?: Record<string, string> }[] = [];
    if (m) {
      try { raw = JSON.parse(m[0]).tools ?? []; } catch { raw = []; }
    }
    const worker: ToolCall[] = [];
    const oracle: OracleToolCall[] = [];
    for (const t of raw) {
      if (!t?.name || already.has(t.name)) continue;
      const q = String(t.params?.q || t.params?.query || message).slice(0, 240);
      if (t.name in TOOL_DESCRIPTIONS) worker.push({ name: t.name as ToolName, params: t.params || { q } });
      else if (t.name === "memory_recall" || t.name === "memory_save" || t.name === "jobs_hunt" || t.name === "sunflower" || t.name === "see") {
        if ((t.name === "jobs_hunt" || t.name === "sunflower") && !architect) continue;
        oracle.push({ name: t.name as OracleToolName, query: q });
      }
      already.add(t.name);
      if (worker.length + oracle.length >= room) break;
    }
    return { worker, oracle };
  } catch {
    return { worker: [], oracle: [] };
  }
}

export async function collectOracleCalls(
  message: string,
  opts: { architect: boolean; hasImage?: boolean; adapter?: ModelAdapter },
): Promise<{ worker: ToolCall[]; oracle: OracleToolCall[]; planner: OracleTurn["planner"] }> {
  const worker = detectTools(message);
  const oracle = detectOracleTools(message, { hasImage: opts.hasImage });
  let planner: OracleTurn["planner"] = worker.length || oracle.length ? "regex" : "none";
  const already = new Set<string>([...worker.map((c) => c.name), ...oracle.map((c) => c.name)]);
  const room = MAX_TOOLS_PER_TURN - already.size;
  if (room > 0 && opts.adapter) {
    // Regex is the floor. JSON planning may add more, and also runs when regex missed.
    const extra = await planExtra(opts.adapter, message, opts.architect, already, room);
    if (extra.worker.length || extra.oracle.length) planner = planner === "none" ? "regex+json" : "regex+json";
    worker.push(...extra.worker);
    oracle.push(...extra.oracle);
  } else if (room > 0 && !oracle.length && !worker.length && opts.adapter) {
    // Fall back to the existing worker-only planner when we have no local adapter wrapper yet.
    const planned = await planWithModel(opts.adapter, message);
    for (const c of planned) {
      if (already.has(c.name)) continue;
      worker.push(c);
      already.add(c.name);
      if (worker.length + oracle.length >= MAX_TOOLS_PER_TURN) break;
    }
    if (planned.length) planner = "regex+json";
  }
  return {
    worker: capCalls(worker, MAX_TOOLS_PER_TURN),
    oracle: capCalls(oracle, Math.max(0, MAX_TOOLS_PER_TURN - capCalls(worker, MAX_TOOLS_PER_TURN).length)).map(oracleCallToQuery),
    planner,
  };
}

export type ToolLoopStep = {
  context: string;
  results: ToolResult[];
  sources: ToolSource[];
  oracle: OracleToolResult[];
  used: { name: string; ok: boolean }[];
  planner: OracleTurn["planner"];
  stopped: boolean;
};

/** Shared tool step for Omni Lab and the main chat. Caps tools per turn. */
export async function runToolLoop(
  userInput: string,
  opts: OracleOpts & { adapter?: ModelAdapter },
): Promise<ToolLoopStep> {
  if (seriousHarmStop(userInput)) {
    return { context: "", results: [], sources: [], oracle: [], used: [], planner: "none", stopped: true };
  }
  const adapter = opts.adapter;
  const picked = await collectOracleCalls(userInput, {
    architect: opts.architect,
    hasImage: !!opts.image,
    adapter,
  });
  if (!picked.worker.length && !picked.oracle.length) {
    return { context: "", results: [], sources: [], oracle: [], used: [], planner: picked.planner, stopped: false };
  }
  const toolsUrl = opts.toolsUrl || PROXY;
  const [worker, oracle] = await Promise.all([
    Promise.all(picked.worker.map((c) => runTool(toolsUrl, c, opts.location))),
    runOracleTools(picked.oracle, { architect: opts.architect, speakerId: opts.speakerId, image: opts.image }),
  ]);
  const context = `${toolContext(worker)}${oracleToolContext(oracle)}`;
  const used = [
    ...worker.map((r) => ({ name: r.name, ok: r.ok })),
    ...oracle.map((r) => ({ name: r.name, ok: r.ok })),
  ];
  return {
    context,
    results: worker,
    sources: worker.flatMap((r) => r.sources),
    oracle,
    used,
    planner: picked.planner,
    stopped: false,
  };
}

export async function runOracle(userInput: string, opts: OracleOpts): Promise<OracleTurn> {
  const text = userInput.trim();
  if (!text && !opts.image) {
    return { reply: "", brain: "rented", modelId: "", escalated: false, stopped: false, planner: "none", worker: [], oracle: [], sources: [], used: [], error: "Nothing to ask." };
  }

  if (seriousHarmStop(text)) {
    return {
      reply: HARM_STOP_REPLY,
      brain: "stopped",
      modelId: "",
      escalated: false,
      stopped: true,
      planner: "none",
      worker: [],
      oracle: [],
      sources: [],
      used: [],
    };
  }

  if (isE2EOmni() && !opts.live) {
    return { ...EXAMPLE_ORACLE, reply: EXAMPLE_ORACLE.reply };
  }

  const pack = loadedPack();
  const adapter: ModelAdapter = pack
    ? {
        async generate(req: ModelRequest): Promise<ModelResponse> {
          const out = await generateWithActiveBrain({
            userText: req.userInput,
            systemContext: req.systemContext,
            preferLocal: true,
            allowEscalate: false,
            maxTokens: req.generation?.maxTokens ?? 180,
            temperature: req.generation?.temperature ?? 0,
          });
          if (out.error && !out.reply) throw new Error(out.error);
          return { text: out.reply, model: out.modelId, provider: out.brain };
        },
      }
    : rentedAdapter();

  let step: ToolLoopStep;
  try {
    step = await runToolLoop(text, { ...opts, adapter });
  } catch (e) {
    // Tool loop failed — still try to answer, then escalate the brain if needed.
    step = { context: "", results: [], sources: [], oracle: [], used: [], planner: "none", stopped: false };
    const msg = e instanceof Error ? e.message : String(e);
    const gen = await generateWithActiveBrain({
      userText: text,
      systemContext: WILSON_BRAIN_PROMPT,
      preferLocal: !!pack,
      allowEscalate: true,
      maxTokens: 280,
    });
    return {
      reply: gen.reply || "The tool loop failed, and I couldn't get an answer either.",
      brain: gen.brain,
      modelId: gen.modelId,
      escalated: gen.escalated || true,
      stopped: false,
      planner: "none",
      worker: [],
      oracle: [],
      sources: [],
      used: [],
      error: msg,
    };
  }

  const system = `${WILSON_BRAIN_PROMPT}${step.context}`;
  let gen = await generateWithActiveBrain({
    userText: text,
    systemContext: system,
    preferLocal: !!pack,
    allowEscalate: true,
    maxTokens: 360,
  });
  if (!gen.reply && pack) {
    gen = await generateWithActiveBrain({
      userText: text,
      systemContext: system,
      preferLocal: false,
      allowEscalate: true,
      maxTokens: 360,
    });
    gen = { ...gen, escalated: true };
  }
  return {
    reply: gen.reply || "I came back empty. Try me again.",
    brain: gen.brain,
    modelId: gen.modelId,
    escalated: gen.escalated,
    stopped: false,
    planner: step.planner,
    worker: step.results,
    oracle: step.oracle,
    sources: step.sources,
    used: step.used,
    error: gen.error,
  };
}
