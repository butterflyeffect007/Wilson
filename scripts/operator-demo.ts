/**
 * Runs one Operator task end to end from a terminal (no UI), using the real
 * search/page tools and Wilson's brain. Consequential actions are auto-declined.
 *   npx --yes tsx scripts/operator-demo.ts "search for free AI grants for solo founders and list the top 3 with links"
 * Optional: GROQ_API_KEY=... to use the private Groq brain instead of wilson-proxy.
 */
import { runOperator } from "../src/operator/loop";
import { createOperatorTools } from "../src/operator/tools";
import { makeBrain } from "../src/operator/brain";

// Browsers send an Origin header and wilson-proxy only answers known origins; act like the local dev page does.
const realFetch = globalThis.fetch;
globalThis.fetch = (input: any, init: any = {}) => realFetch(input, { ...init, headers: { Origin: process.env.WILSON_ORIGIN || "http://localhost:5173", ...(init.headers || {}) } });

const goal = process.argv.slice(2).join(" ") || "search for free AI grants for solo founders and list the top 3 with links";
const ctl = new AbortController();
process.on("SIGINT", () => ctl.abort());
const t0 = Date.now();
const res = await runOperator(goal, {
  brain: makeBrain({ groqKey: process.env.GROQ_API_KEY || "", groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b" }),
  tools: createOperatorTools({ snapshots: false }),
  hooks: {
    signal: ctl.signal,
    onStep: (s) => { if (s.status !== "running") console.log(`#${s.id} [${s.status}] ${s.kind}: ${s.title}${s.kind === "error" ? " :: " + s.detail : ""}${s.plan ? "\n   - " + s.plan.join("\n   - ") : ""}${s.thought ? `\n   (${s.thought})` : ""}`); },
    confirm: async (r) => { console.log(`?? CONFIRM requested: ${r.reason} -> auto-declined in demo`); return false; },
  },
});
console.log(`\n=== ${res.status} in ${res.steps} steps, ${((Date.now() - t0) / 1000).toFixed(1)}s ===\n${res.answer}`);
