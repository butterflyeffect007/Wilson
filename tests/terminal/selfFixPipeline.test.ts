import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEdits, diffForFiles, isWritablePath, lineDiff, parseEditReply, parseFilePick, simpleStatus, stepperFor, validateChange,
} from "../../src/terminal/selfFixPipeline.ts";

const APP = [
  "export function Footer() {",
  "  return (",
  "    <div className=\"footnote\">",
  "      Wilson + The Only One",
  "    </div>",
  "  );",
  "}",
  "",
].join("\n");

const REPLY = `TITLE: Sparkle in the footer
SUMMARY: Adds a sparkle after the footer text.
FILE: src/Footer.tsx
<<<<<<< SEARCH
      Wilson + The Only One
=======
      Wilson + The Only One ✦
>>>>>>> REPLACE
DONE`;

test("parses a complete edit reply", () => {
  const p = parseEditReply(REPLY);
  assert.equal(p.complete, true);
  assert.equal(p.title, "Sparkle in the footer");
  assert.equal(p.summary, "Adds a sparkle after the footer text.");
  assert.equal(p.edits.length, 1);
  assert.deepEqual(p.problems, []);
});

test("a reply without DONE is treated as cut off", () => {
  const p = parseEditReply(REPLY.replace(/\nDONE$/, ""));
  assert.equal(p.complete, false);
  assert.match(p.problems.join(" "), /cut off/);
});

test("a reply cut mid-edit is refused", () => {
  const p = parseEditReply(REPLY.split("=======")[0]);
  assert.equal(p.complete, false);
  assert.ok(p.problems.length > 0);
});

test("applies targeted edits to the full file and builds a diff", () => {
  const p = parseEditReply(REPLY);
  const r = applyEdits([{ path: "src/Footer.tsx", content: APP, exists: true, sha: "abc" }], p.edits);
  assert.deepEqual(r.problems, []);
  assert.equal(r.files.length, 1);
  const f = r.files[0];
  assert.equal(f.status, "edited");
  assert.equal(f.baseSha, "abc");
  assert.ok(f.content.includes("Wilson + The Only One ✦"));
  assert.equal(f.content.split("\n").length, APP.split("\n").length, "full file kept, nothing truncated");
  assert.deepEqual(validateChange(f), []);
  const d = lineDiff(f.path, f.previous, f.content);
  assert.equal(d[0].kind, "file");
  assert.deepEqual(d.filter((l) => l.kind === "del").map((l) => l.text), ["      Wilson + The Only One"]);
  assert.deepEqual(d.filter((l) => l.kind === "add").map((l) => l.text), ["      Wilson + The Only One ✦"]);
  assert.ok(diffForFiles(r.files).length >= 3);
});

test("tolerates indentation drift but refuses missing or ambiguous SEARCH", () => {
  const drift = applyEdits([{ path: "src/Footer.tsx", content: APP, exists: true }], [
    { path: "src/Footer.tsx", kind: "replace", search: "Wilson + The Only One", replace: "Wilson ✦" },
  ]);
  assert.deepEqual(drift.problems, []);
  assert.ok(drift.files[0].content.includes("Wilson ✦"));
  const missing = applyEdits([{ path: "src/Footer.tsx", content: APP, exists: true }], [
    { path: "src/Footer.tsx", kind: "replace", search: "not in the file", replace: "x" },
  ]);
  assert.match(missing.problems[0], /Couldn't find/);
  const twice = applyEdits([{ path: "src/a.ts", content: "a();\na();\n", exists: true }], [
    { path: "src/a.ts", kind: "replace", search: "a();", replace: "b();" },
  ]);
  assert.match(twice.problems[0], /matches 2 places/);
});

test("never writes outside src/ and public/", () => {
  assert.equal(isWritablePath("src/App.tsx"), true);
  assert.equal(isWritablePath("public/robots.txt"), true);
  for (const p of [".github/workflows/x.yml", "package.json", "workers/a.ts", "src/../vite.config.ts", "src/token.ts"]) {
    assert.equal(isWritablePath(p), false, p);
  }
  const r = applyEdits([], [{ path: "package.json", kind: "create", content: "{}" }]);
  assert.equal(r.files.length, 0);
  assert.ok(r.problems.length);
});

test("creates new files only when they don't exist", () => {
  const reply = `TITLE: Note\nSUMMARY: Adds a note.\nFILE: public/note.txt\n<<<<<<< NEW FILE\nhello\n>>>>>>> END\nDONE`;
  const p = parseEditReply(reply);
  assert.equal(p.complete, true);
  const r = applyEdits([{ path: "public/note.txt", content: "", exists: false }], p.edits);
  assert.equal(r.files[0].status, "added");
  assert.equal(r.files[0].content, "hello");
});

test("validation refuses empty, shrunken, placeholder, and unbalanced output", () => {
  const big = "const x = {\n" + "  a: 1,\n".repeat(200) + "};\n";
  assert.ok(validateChange({ path: "src/a.ts", status: "edited", previous: big, content: "  " }).length);
  assert.match(validateChange({ path: "src/a.ts", status: "edited", previous: big, content: "const x = {\n};\n" }).join(" "), /half/);
  assert.match(validateChange({ path: "src/a.ts", status: "edited", previous: "f();\n", content: "f();\n// ... rest of the code\n" }).join(" "), /placeholder/);
  assert.match(validateChange({ path: "src/a.ts", status: "edited", previous: "if (a) { b(); }\n", content: "if (a) { b();\n" }).join(" "), /brackets/);
  assert.match(validateChange({ path: "public/m.json", status: "edited", previous: "{}", content: "{\"a\":" }).join(" "), /JSON|brackets/);
});

test("file pick accepts JSON or plain paths and filters unknown/blocked ones", () => {
  const avail = ["src/App.tsx", "src/terminal/WilsonTerminal.tsx"];
  assert.deepEqual(parseFilePick('{"files":["src/App.tsx","package.json"]}', avail), ["src/App.tsx"]);
  assert.deepEqual(parseFilePick("I need src/terminal/WilsonTerminal.tsx please", avail), ["src/terminal/WilsonTerminal.tsx"]);
});

test("stepper: proposed -> waiting for you -> publishing -> live", () => {
  assert.equal(stepperFor("draft").step, 0);
  assert.equal(stepperFor("review", undefined, "running").step, 1);
  assert.match(stepperFor("review", undefined, "failed").detail, /FAILED/);
  assert.equal(stepperFor("live", "building").headline, "Publishing…");
  assert.equal(stepperFor("live", "live").headline, "Live — close and reopen Wilson to see it.");
  assert.equal(stepperFor("live", "failed").tone, "warn");
  assert.equal(stepperFor("declined").headline, "Declined");
});

test("simple status uses plain words: no PR / diff / merge / deploy / build check", () => {
  const all = [
    simpleStatus("draft"), simpleStatus("review"), simpleStatus("review", undefined, "passed"), simpleStatus("review", undefined, "failed"),
    simpleStatus("live", "building"), simpleStatus("live", "live"), simpleStatus("live", "failed"),
    simpleStatus("undone", "publishing"), simpleStatus("undone", "live"), simpleStatus("declined"),
  ];
  for (const s of all) assert.doesNotMatch(`${s.title} ${s.text}`, /\b(PR|pull request|diff|merge|merged|deploy|build check|GitHub)\b/i);
  assert.equal(simpleStatus("review", undefined, "passed").title, "Safety check passed.");
  assert.equal(simpleStatus("live", "live").title, "It's live!");
  assert.equal(simpleStatus("live", "live").step, 3);
  assert.equal(simpleStatus("live", "building").settled, false);
  assert.equal(simpleStatus("review").step, 1);
});
