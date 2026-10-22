import test from "node:test";
import assert from "node:assert/strict";
import { executePipeline, PipelineDefinitionError, validateGraph, type PipelineNode } from "../src/pipeline.ts";
import { createMockFeed } from "../src/sources/mockFeeds.ts";
import { provenanceHash, reconcileObservations } from "../src/reconcile.ts";

const context = { runId: "test-run-001", graphVersion: "v1" };
const node = (id: string, dependsOn: string[] = [], execute: PipelineNode["execute"] = async () => ({ ok: true })): PipelineNode => ({
  id, operation: `${id}:v1`, dependsOn, input: null, maxAttempts: 1,
  idempotencyKey: (ctx) => `${ctx.runId}:${id}`, execute,
});

test("divergent mock feeds preserve both observations and flag conflict", async () => {
  const [alpha, beta] = await Promise.all([
    createMockFeed("mock-feed-alpha", 7.2)(),
    createMockFeed("mock-feed-beta", 8.1)(),
  ]);
  const [group] = reconcileObservations([alpha, beta]);
  assert.equal(group.status, "conflict");
  assert.deepEqual(group.distinctValues.sort((a, b) => a - b), [7.2, 8.1]);
  assert.equal(group.observations.length, 2);
  assert.deepEqual(group.observations.map((item) => item.source.source_id).sort(), ["mock-feed-alpha", "mock-feed-beta"]);
});

test("matching values are consistent, without discarding provenance", async () => {
  const alpha = await createMockFeed("mock-feed-alpha", 7.2)();
  const beta = await createMockFeed("mock-feed-beta", 7.2)();
  const [group] = reconcileObservations([alpha, beta]);
  assert.equal(group.status, "consistent");
  assert.equal(group.observations.length, 2);
});

test("invalid envelopes are rejected rather than coerced", () => {
  assert.throws(() => reconcileObservations([{ measurement: { value: "7.2" } }]), /Invalid normalized/);
});

test("failed source blocks its dependent but healthy independent branch succeeds", async () => {
  const graph: PipelineNode[] = [
    node("source.alpha", [], async () => { throw new Error("mock source offline"); }),
    node("source.beta"),
    node("reconcile", ["source.alpha", "source.beta"]),
    node("independent.audit"),
  ];
  const result = await executePipeline(graph, context, 2);
  assert.equal(result.nodes["source.alpha"].status, "failed");
  assert.equal(result.nodes["source.beta"].status, "succeeded");
  assert.equal(result.nodes.reconcile.status, "blocked");
  assert.equal(result.nodes["independent.audit"].status, "succeeded");
  assert.equal(result.status, "partial");
});

test("node retries are bounded", async () => {
  let attempts = 0;
  const retrying = node("retry", [], async () => {
    attempts += 1;
    throw new Error("still failing");
  });
  retrying.maxAttempts = 3;
  const result = await executePipeline([retrying], context);
  assert.equal(attempts, 3);
  assert.equal(result.nodes.retry.attempts, 3);
  assert.equal(result.nodes.retry.status, "failed");
});

test("graph rejects missing dependencies and cycles", () => {
  assert.throws(() => validateGraph([node("a", ["missing"])]), PipelineDefinitionError);
  assert.throws(() => validateGraph([node("a", ["b"]), node("b", ["a"])]), /Cycle detected/);
});

test("canonical provenance hash changes when content changes", async () => {
  const first = await provenanceHash({ value: 7.2, source: "alpha" });
  const sameContentDifferentKeyOrder = await provenanceHash({ source: "alpha", value: 7.2 });
  const changed = await provenanceHash({ value: 8.1, source: "alpha" });
  assert.equal(first, sameContentDifferentKeyOrder);
  assert.notEqual(first, changed);
});
