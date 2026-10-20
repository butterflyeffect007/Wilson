/**
 * Wilson Branching Pipeline Grid — minimal DAG execution core.
 *
 * This module is intentionally infrastructure-agnostic. It does not fetch URLs,
 * persist checkpoints, or claim crash recovery. Adapters supply node handlers
 * and durable state storage in later steps.
 */

export type NodeStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

export interface PipelineContext {
  runId: string;
  graphVersion: string;
  signal?: AbortSignal;
}

export interface PipelineNode<TInput = unknown, TOutput = unknown> {
  id: string;
  /** Stable versioned operation name, e.g. "source.fetch:v1". */
  operation: string;
  /** Node IDs that must succeed before this node runs. */
  dependsOn: string[];
  /** Stable key used by a future durable/idempotency adapter. */
  idempotencyKey: (context: PipelineContext, input: TInput) => string;
  input: TInput;
  maxAttempts?: number;
  execute: (
    input: TInput,
    context: PipelineContext,
    dependencies: Readonly<Record<string, unknown>>,
  ) => Promise<TOutput>;
}

export interface NodeResult {
  nodeId: string;
  operation: string;
  status: NodeStatus;
  attempts: number;
  output?: unknown;
  error?: string;
  idempotencyKey: string;
}

export interface PipelineResult {
  runId: string;
  graphVersion: string;
  status: "succeeded" | "partial" | "failed";
  nodes: Record<string, NodeResult>;
}

export class PipelineDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineDefinitionError";
  }
}

export function validateGraph(nodes: readonly PipelineNode[]): void {
  const byId = new Map<string, PipelineNode>();

  for (const node of nodes) {
    if (!node.id.trim()) throw new PipelineDefinitionError("Node id cannot be empty");
    if (byId.has(node.id)) throw new PipelineDefinitionError(`Duplicate node id: ${node.id}`);
    if (!node.operation.trim()) throw new PipelineDefinitionError(`Missing operation for ${node.id}`);
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) {
        throw new PipelineDefinitionError(
          `Node ${node.id} depends on unknown node ${dependency}`,
        );
      }
      if (dependency === node.id) {
        throw new PipelineDefinitionError(`Node ${node.id} cannot depend on itself`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) throw new PipelineDefinitionError(`Cycle detected at node ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of nodes) visit(node.id);
}

export async function executePipeline(
  nodes: readonly PipelineNode[],
  context: PipelineContext,
  concurrency = 4,
): Promise<PipelineResult> {
  validateGraph(nodes);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const results: Record<string, NodeResult> = {};
  const remaining = new Set(nodes.map((node) => node.id));

  const dependencyState = (node: PipelineNode): "ready" | "blocked" | "waiting" => {
    const states = node.dependsOn.map((id) => results[id]?.status);
    if (states.some((status) => status === "failed" || status === "blocked")) return "blocked";
    if (states.every((status) => status === "succeeded")) return "ready";
    return "waiting";
  };

  while (remaining.size > 0) {
    if (context.signal?.aborted) {
      for (const id of remaining) {
        const node = byId.get(id)!;
        results[id] = {
          nodeId: id,
          operation: node.operation,
          status: "blocked",
          attempts: 0,
          error: "Pipeline aborted before node execution",
          idempotencyKey: node.idempotencyKey(context, node.input),
        };
      }
      break;
    }

    let madeProgress = false;

    for (const id of [...remaining]) {
      const node = byId.get(id)!;
      if (dependencyState(node) === "blocked") {
        results[id] = {
          nodeId: id,
          operation: node.operation,
          status: "blocked",
          attempts: 0,
          error: "One or more dependencies did not succeed",
          idempotencyKey: node.idempotencyKey(context, node.input),
        };
        remaining.delete(id);
        madeProgress = true;
      }
    }

    const ready = [...remaining]
      .map((id) => byId.get(id)!)
      .filter((node) => dependencyState(node) === "ready")
      .slice(0, concurrency);

    if (ready.length === 0) {
      if (!madeProgress && remaining.size > 0) {
        throw new PipelineDefinitionError("Execution stalled despite graph validation");
      }
      continue;
    }

    const settled = await Promise.all(
      ready.map(async (node): Promise<NodeResult> => {
        const idempotencyKey = node.idempotencyKey(context, node.input);
        const maxAttempts = Math.max(1, Math.floor(node.maxAttempts ?? 1));
        let lastError = "Unknown execution error";

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (context.signal?.aborted) {
            return {
              nodeId: node.id,
              operation: node.operation,
              status: "blocked",
              attempts: attempt - 1,
              error: "Pipeline aborted",
              idempotencyKey,
            };
          }

          try {
            const dependencies: Record<string, unknown> = {};
            for (const dependency of node.dependsOn) {
              dependencies[dependency] = results[dependency]?.output;
            }
            const output = await node.execute(node.input, context, dependencies);
            return {
              nodeId: node.id,
              operation: node.operation,
              status: "succeeded",
              attempts: attempt,
              output,
              idempotencyKey,
            };
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        return {
          nodeId: node.id,
          operation: node.operation,
          status: "failed",
          attempts: maxAttempts,
          error: lastError,
          idempotencyKey,
        };
      }),
    );

    for (const result of settled) {
      results[result.nodeId] = result;
      remaining.delete(result.nodeId);
    }
  }

  const statuses = Object.values(results).map((result) => result.status);
  const status: PipelineResult["status"] = statuses.every((item) => item === "succeeded")
    ? "succeeded"
    : statuses.every((item) => item === "failed" || item === "blocked")
      ? "failed"
      : "partial";

  return { runId: context.runId, graphVersion: context.graphVersion, status, nodes: results };
}
