import { fetchSourceFile, fetchSourceTree, type SelfFixFile, type SelfFixProposal } from "./selfFix";
import { parseEditReply, applyEdits, validateChange, diffForFiles, EDIT_SYSTEM, editUserPrompt, PICK_SYSTEM, pickUserPrompt, parseFilePick, type SourceFile } from "./selfFixPipeline";
import { makeTerminalAdapter, askWilson } from "./agentLoop";

export async function buildSelfFixProposal(
  request: string,
  options?: { signal?: AbortSignal; onStep?: (step: string) => void },
): Promise<SelfFixProposal> {
  const onStep = options?.onStep || (() => {});
  const signal = options?.signal;
  const adapter = makeTerminalAdapter();

  onStep("Reading project tree…");
  const tree = await fetchSourceTree();
  const paths = tree.map((t) => t.path);

  onStep("Choosing files to read…");
  const pickPrompt = pickUserPrompt(request, paths);
  let pickReply = "";
  try {
    pickReply = await askWilson(adapter, pickPrompt, [], (full) => { pickReply = full; }, signal || new AbortSignal());
  } catch {
    // fallback to sensible defaults if pick fails
  }

  const pickedPaths = parseFilePick(pickReply, paths);
  if (!pickedPaths.length) {
    // fallback to main terminal or app files
    pickedPaths.push("src/terminal/WilsonTerminal.tsx", "src/App.tsx");
  }

  onStep(`Reading ${pickedPaths.length} file(s)…`);
  const sources: SourceFile[] = [];
  for (const p of pickedPaths) {
    try {
      const f = await fetchSourceFile(p);
      sources.push({ path: f.path, content: f.content, exists: f.exists, sha: f.sha });
    } catch {
      sources.push({ path: p, content: "", exists: false });
    }
  }

  let feedback: string | undefined = undefined;
  let lastReply = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) throw new Error("Stopped.");
    onStep(`Writing change (attempt ${attempt}/3)…`);

    const userPrompt = editUserPrompt(request, sources, feedback);
    let reply = "";
    try {
      reply = await askWilson(adapter, userPrompt, [{ role: "user", content: pickPrompt }, { role: "assistant", content: pickReply }], (full) => { reply = full; }, signal || new AbortSignal());
    } catch (err) {
      if (signal?.aborted) throw new Error("Stopped.");
      throw new Error(err instanceof Error ? err.message : "AI generation failed.");
    }

    lastReply = reply;
    const parsed = parseEditReply(reply);
    if (!parsed.complete && attempt < 3) {
      feedback = parsed.problems.join("\n") || "The reply was incomplete or cut off.";
      continue;
    }

    const applied = applyEdits(sources, parsed.edits);
    if (applied.problems.length && attempt < 3) {
      feedback = applied.problems.join("\n");
      continue;
    }

    if (!applied.files.length) {
      feedback = "The edits didn't actually change anything. Make sure SEARCH parts match the file contents exactly.";
      continue;
    }

    let validationErrors: string[] = [];
    for (const file of applied.files) {
      validationErrors = validationErrors.concat(validateChange(file));
    }

    if (validationErrors.length && attempt < 3) {
      feedback = validationErrors.join("\n");
      continue;
    }

    const diff = diffForFiles(applied.files);
    const files: SelfFixFile[] = applied.files.map((f) => ({
      path: f.path,
      status: f.status,
      content: f.content,
      baseSha: f.baseSha,
    }));

    return {
      title: parsed.title || request.slice(0, 40),
      summary: parsed.summary || request,
      changelogTitle: parsed.title || request.slice(0, 40),
      changelogBody: parsed.summary || request,
      files,
      diff,
      status: "draft",
      request,
    };
  }

  const fallbackApplied = applyEdits(sources, parseEditReply(lastReply).edits);
  if (fallbackApplied.files.length) {
    const diff = diffForFiles(fallbackApplied.files);
    const files: SelfFixFile[] = fallbackApplied.files.map((f) => ({
      path: f.path,
      status: f.status,
      content: f.content,
      baseSha: f.baseSha,
    }));
    return {
      title: request.slice(0, 40),
      summary: request,
      files,
      diff,
      status: "draft",
      request,
    };
  }

  throw new Error("Could not apply edits cleanly after several attempts.");
}