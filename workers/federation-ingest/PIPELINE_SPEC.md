# Branching Pipeline Grid — first execution-graph specification

Status: prototype specification, not production-certified.

## First node

The first executable node is `source.fetch`. It must receive an explicitly configured, authorized source and emit a normalized envelope. It must never accept arbitrary URLs from an untrusted client.

## Execution model

- A pipeline is a directed acyclic graph (DAG) of named nodes.
- Each node declares its dependencies and a stable operation key.
- A node runs only after all dependencies succeed.
- Independent ready nodes may run concurrently.
- A failed node blocks only its downstream dependents; unrelated branches may continue.
- Each node result carries a status and structured error details.
- Retried operations must be idempotent or use an idempotency key.
- A run records graph version, run ID, node status, attempts, and output references.
- The execution engine does not itself claim durable checkpoints. Persistence is a separate adapter and is required before crash recovery can be claimed.
- Provenance is attached after normalization and before storage/indexing. Hashes establish content integrity, not source truth.

## Initial graph

```text
source.fetch.alpha ─┐
                    ├─> records.reconcile ─> provenance.hash ─> storage.persist
source.fetch.beta  ─┘
```

Each source branch can fetch and normalize independently. Reconciliation preserves both source observations and flags disagreement; it must not silently select a winner.

## Failure semantics

1. A node may be retried a bounded number of times.
2. A failed dependency marks downstream nodes as blocked.
3. Independent branches continue where possible.
4. Re-running a completed node must not duplicate durable records; use a stable idempotency key.
5. Durable recovery requires storing run state and outputs outside the worker process.

## First acceptance tests

- Reject a graph with missing dependencies or a cycle.
- Run independent source nodes without imposing a false dependency between them.
- Preserve both source values when sources disagree.
- Fail one source and verify unrelated branches still finish.
- Verify provenance changes when canonical record content changes.
- Simulate process termination and confirm recovery only after checkpoint persistence is implemented.
