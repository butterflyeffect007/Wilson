import { extractFencedBlocks } from "../lib/codeFence.ts";

/** Prefer a python fence; fall back to an unlabeled fence. */
export function extractRunnablePython(text: string): string | null {
  const blocks = extractFencedBlocks(text).filter((b) => b.code.trim());
  if (!blocks.length) return null;
  const named = blocks.find((b) => /^(python|py|python3)$/i.test(b.lang));
  if (named) return named.code;
  const unlabeled = blocks.find((b) => !b.lang);
  return unlabeled ? unlabeled.code : null;
}

export async function typeCode(code: string, write: (s: string) => void, signal: AbortSignal, msPerChunk = 12): Promise<void> {
  let out = "";
  for (let i = 0; i < code.length; ) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const n = Math.min(code.length - i, 5);
    out += code.slice(i, i + n);
    i += n;
    write(out);
    if (i < code.length) await new Promise((r) => setTimeout(r, msPerChunk));
  }
}
