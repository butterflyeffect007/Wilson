import test from "node:test";
import assert from "node:assert/strict";
import { extractRunnablePython } from "../../src/terminal/pythonFence.ts";
import { canOpenTerminal, isE2EArchitect } from "../../src/terminal/access.ts";

test("prefers a python fence over an unlabeled one", () => {
  const text = "Sure.\n\n```\necho hi\n```\n\n```python\nprint(1)\n```\n";
  assert.equal(extractRunnablePython(text), "print(1)");
});

test("falls back to an unlabeled fence", () => {
  assert.equal(extractRunnablePython("```\nimport numpy as np\n```"), "import numpy as np");
});

test("ignores js fences and empty blocks", () => {
  assert.equal(extractRunnablePython("```js\nconsole.log(1)\n```\n"), null);
  assert.equal(extractRunnablePython("no fences here"), null);
});

test("Architect gate is closed without admin or localhost e2e flag", () => {
  assert.equal(canOpenTerminal(true), true);
  assert.equal(canOpenTerminal(false), false);
  assert.equal(isE2EArchitect(), false);
});
