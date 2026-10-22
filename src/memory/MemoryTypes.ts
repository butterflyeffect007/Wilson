/**
 * MemoryTypes — type-only stubs for future memory concepts.
 *
 * Proposal #1: types only. Must NOT implement storage, retrieval,
 * summarization, embeddings, vector search, persistence, or behavioral
 * memory.
 */

export interface UserMemory {
  userId: string;
  preferences?: Record<string, unknown>;
  facts?: string[];
}

export interface RelationshipMemory {
  userId: string;
  notes?: string[];
  trustLevel?: number;
}

export interface SessionContext {
  sessionId: string;
  startedAt: number;
  turns?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySnapshot {
  user?: UserMemory;
  relationship?: RelationshipMemory;
  session?: SessionContext;
}
