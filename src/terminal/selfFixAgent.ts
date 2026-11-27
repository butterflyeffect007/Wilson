/**
 * Wilson builds a REAL self-fix proposal: reads his own files from GitHub (through the worker),
 * asks his brain for targeted edits, applies them to the full file contents, validates, diffs,
 * and refuses a change that doesn't actually do what Jenny asked.
 * Nothing is sent to GitHub here — submitForReview does that.
 */
import type { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import type { ModelRequest } from "../intelligence/ModelRequest";
import { makeTerminalAdapter } from "./agentLoop";
import { fetchSourceFile, fetchSourceTree, type SelfFixProposal } from "./selfFix";
import { titleFromRequest } from "./selfFixIntent";
import {
  EDIT_SYSTEM, PICK_SYSTEM, applyEdits, diffForFiles, editPromptMessages, parseEditReply, parseFilePick,
  pickUserPrompt, relevanceProblems, validateChange, type SourceFile,
} from "./selfFixPipeline";

export type BuildHooks = {
  onStep: (text: string) => void;
  signal: AbortSignal;
  adapter?: OpenRouterAdapter;
};

const MAX_TOTAL_CHARS = 140_000;

async function ask(adapter: OpenRouterAdapter, system: string, user: string, maxTokens: number, signal: AbortSignal, history: ModelRequest["conversation"] = []) {
  const request: ModelRequest = {
    systemContext: system,
    conversation: history,
    userInput: user,
    generation: { temperature: 0.2, maxTokens },
    metadata: { task: "selffix" },
  };
  const res = await adapter.generateStream(request, () => {}, signal);
  if (res.finishReason === "aborted") throw Object.assign(new Error("Stopped."), { name: "AbortError" });
  return res;
}

export async function buildSelfFixProposal(request: string, hooks: BuildHooks): Promise<SelfFixProposal> {
  const adapter = hooks.adapter ?? makeTerminalAdapter();
  const { onStep, signal } = hooks;

  onStep("Looking through my own code…");
  const tree = await fetchSourceTree();
  if (!tree.length) throw new Error("I couldn't list my own files just now. Nothing was sent anywhere.");
  const paths = tree.map((t) => t.path);

  // Paths she named directly always count.
  const named = parseFilePick(request, paths).filter((p) => paths.includes(p));
  let chosen = named;
  if (!chosen.length) {
    const pick = await ask(adapter, PICK_SYSTEM, pickUserPrompt(request, paths), 400, signal);
    chosen = parseFilePick(pick.text, paths);
  }
  if (!chosen.length) {
    throw new Error("I couldn't tell which of my files to change. Tell me the screen or file name and I'll try again. Nothing was sent anywhere.");
  }
  // Visual title/header asks almost always need the markup and the stylesheet, even if the picker only named one.
  if (/\b(shimmer|sparkle|glow|shine|glitter|title|header)\b/i.test(request)) {
    for (const extra of ["src/App.tsx", "src/index.css"]) {
      if (paths.includes(extra) && !chosen.includes(extra)) chosen.push(extra);
    }
  }

  const sources: SourceFile[] = [];
  let total = 0;
  for (const path of chosen) {
    if (signal.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
    onStep(`Reading ${path}…`);
    const f = await fetchSourceFile(path);
    total += f.content.length;
    if (total > MAX_TOTAL_CHARS) break;
    sources.push({ path: f.path, content: f.content, exists: f.exists, sha: f.sha });
  }
  if (!sources.length) throw new Error("Those files are too big for one change. Ask for something smaller. Nothing was sent anywhere.");

  let feedback = "";
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) throw Object.assign(new Error("Stopped."), { name: "AbortError" });
    onStep(attempt === 1 ? "Writing the change…" : "Fixing my first try…");
    let res;
    try {
      const prompt = editPromptMessages(request, sources, feedback || undefined);
      res = await ask(adapter, EDIT_SYSTEM, prompt.user, 4096, signal, prompt.history);
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      if (/\b413\b/.test(msg)) {
        throw new Error("The files were too big to send in one go. Tell me the screen or file if you can. Nothing was sent anywhere.");
      }
      throw err;
    }
    const parsed = parseEditReply(res.text);
    const problems = [...parsed.problems];
    if (res.finishReason === "length") problems.unshift("My reply hit the length limit and was cut off.");
    let files: ReturnType<typeof applyEdits>["files"] = [];
    if (!problems.length) {
      onStep("Checking it…");
      const applied = applyEdits(sources, parsed.edits);
      problems.push(...applied.problems);
      files = applied.files;
      if (!problems.length && !files.length) problems.push("The edits didn't actually change anything.");
      for (const f of files) problems.push(...validateChange(f));
      if (!problems.length) {
        const diff = diffForFiles(files);
        const title = titleFromRequest(request, parsed.title);
        problems.push(...relevanceProblems(request, {
          title,
          summary: parsed.summary || title,
          files,
          diff,
        }));
        if (!problems.length) {
          return {
            id: `draft-${Date.now().toString(36)}`,
            title,
            summary: parsed.summary || title,
            changelogTitle: title,
            changelogBody: parsed.summary || title,
            files: files.map((f) => ({ path: f.path, status: f.status, content: f.content, baseSha: f.baseSha ?? null })),
            diff,
            status: "draft",
            request,
            createdAt: new Date().toISOString(),
          };
        }
      }
    }
    feedback = problems.map((p) => `- ${p}`).join("\n");
    if (attempt === maxAttempts) {
      throw new Error(`I won't propose this because it doesn't actually do what you asked:\n${feedback}\nNothing was sent anywhere.`);
    }
  }
  throw new Error("I couldn't make a clean change that matches what you asked. Nothing was sent anywhere.");
}
