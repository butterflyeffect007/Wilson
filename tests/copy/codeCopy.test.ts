import test from "node:test";
import assert from "node:assert/strict";
import { extractFencedBlocks, parseFenceAt, isLongInlineCommand, LONG_INLINE_CODE_MIN } from "../../src/lib/codeFence.ts";

const SAMPLE = `Here's a short script you can drop into Pyto:

\`\`\`python
import math

print("hello, Jenny")
print(math.sqrt(math.pi))
\`\`\`

A one-liner: \`python3 /var/mobile/Downloads/pulse.py --preview\`

And a second block:

\`\`\`
echo "plain"
\`\`\`
`;

test("extracts language and raw body, without fences or line numbers", () => {
  const blocks = extractFencedBlocks(SAMPLE);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].lang, "python");
  assert.equal(blocks[0].code, 'import math\n\nprint("hello, Jenny")\nprint(math.sqrt(math.pi))');
  assert.equal(blocks[1].lang, "");
  assert.equal(blocks[1].code, 'echo "plain"');
  assert.ok(!blocks[0].code.includes("```"));
  assert.ok(!blocks[0].code.includes("1|") && !/^\s*\d+\s/.test(blocks[0].code));
});

test("preserves indentation, straight quotes, and inner backticks", () => {
  const src = "```js\n  const x = `hi`;\n  foo(\"bar\")\n```";
  const [block] = extractFencedBlocks(src);
  assert.equal(block.lang, "js");
  assert.equal(block.code, '  const x = `hi`;\n  foo("bar")');
  assert.equal(block.code.includes("\u201c") || block.code.includes("\u201d"), false);
});

test("does not invent or convert quotes when the source has curly ones", () => {
  const src = "```\nSay \u201Chello\u201D\n```";
  const [block] = extractFencedBlocks(src);
  assert.equal(block.code, "Say \u201Chello\u201D");
});

test("parseFenceAt skips the closing fence and leaves following lines alone", () => {
  const lines = ["before", "```c++", "int n = 1;", "```", "after"];
  const block = parseFenceAt(lines, 1);
  assert.ok(block);
  assert.equal(block!.lang, "c++");
  assert.equal(block!.code, "int n = 1;");
  assert.equal(block!.end, 4);
  assert.equal(lines[block!.end], "after");
});

test("unclosed fence takes the rest of the message", () => {
  const [block] = extractFencedBlocks("```bash\necho 1\necho 2\n");
  assert.equal(block.lang, "bash");
  assert.equal(block.code, "echo 1\necho 2\n");
});

test("empty fenced block is still extracted", () => {
  const [block] = extractFencedBlocks("```\n```");
  assert.deepEqual(block, { lang: "", code: "" });
});

test("long inline commands are promoted; short snippets stay inline", () => {
  assert.equal(isLongInlineCommand("python3"), false);
  const cmd = "python3 /var/mobile/Downloads/pulse.py --preview";
  assert.ok(cmd.length >= LONG_INLINE_CODE_MIN);
  assert.equal(isLongInlineCommand(cmd), true);
  assert.equal(isLongInlineCommand("x".repeat(LONG_INLINE_CODE_MIN - 1)), false);
  assert.equal(isLongInlineCommand("x".repeat(LONG_INLINE_CODE_MIN)), true);
});
