/** Parse ``` fenced blocks into raw code (no fences, no line numbers). */

export type FencedBlock = { lang: string; code: string; end: number };

/**
 * If lines[i] opens a markdown fence, return the language, the exact body text,
 * and the index just after the closing fence (or past the last line if unclosed).
 */
export function parseFenceAt(lines: string[], i: number): FencedBlock | null {
  const fence = lines[i].match(/^\s*```\s*([\w+-]*)/);
  if (!fence) return null;
  const body: string[] = [];
  let j = i + 1;
  while (j < lines.length && !/^\s*```/.test(lines[j])) body.push(lines[j++]);
  return { lang: fence[1] || "", code: body.join("\n"), end: j + 1 };
}

/** Walk a message and return every fenced block's language + raw code. */
export function extractFencedBlocks(text: string): { lang: string; code: string }[] {
  const lines = text.split("\n");
  const out: { lang: string; code: string }[] = [];
  let i = 0;
  while (i < lines.length) {
    const block = parseFenceAt(lines, i);
    if (block) {
      out.push({ lang: block.lang, code: block.code });
      i = block.end;
      continue;
    }
    i++;
  }
  return out;
}

/** Inline `code` this long is treated as a command and shown with a Copy button. */
export const LONG_INLINE_CODE_MIN = 40;

export function isLongInlineCommand(code: string): boolean {
  return code.length >= LONG_INLINE_CODE_MIN;
}
