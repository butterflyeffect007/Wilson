/**
 * Long-term memory — on-device vector search (fallback mode).
 * Embeddings: transformers.js Xenova/all-MiniLM-L6-v2 (384-d), lazy-loaded.
 * Storage: IndexedDB in this browser only. (Cloudflare Vectorize/D1 sync is not
 * enabled: the current API token lacks those permissions.)
 */
export interface MemoryItem {
  id: string;
  text: string;
  speakerId: string;
  emotion: string | null;
  ts: string;
  vec: number[];
}

import { isIOS } from "./ortSetup";
import { getPuckState } from "./puckVoice";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DB = "wilson_memory", STORE = "items";
let extractor: Promise<any> | null = null;

function loadExtractor() {
  // iPhone: one page gets one memory budget. Don't load the memory-search model while Puck's voice is still loading
  // (this turn just skips recall); once Puck is ready both fit.
  if (!extractor && isIOS() && getPuckState() === "loading") return Promise.reject(new Error("waiting for Puck to finish loading"));
  if (!extractor) {
    extractor = import("@huggingface/transformers")
      .then(async (t) => { (await import("./ortSetup")).configureOrt(t.env); return t; })
      .then((t) => t.pipeline("feature-extraction", MODEL, { dtype: "q8" } as any))
      .catch((e) => { extractor = null; throw e; });
  }
  return extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const fe = await loadExtractor();
  const out = await fe(text, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const listMemories = () => tx<MemoryItem[]>("readonly", (s) => s.getAll() as IDBRequest<MemoryItem[]>);
export const deleteMemory = (id: string) => tx("readwrite", (s) => s.delete(id));
export const clearMemories = () => tx("readwrite", (s) => s.clear());

export async function upsertMemory(text: string, speakerId: string, emotion: string | null): Promise<void> {
  const vec = await embedText(text);
  const item: MemoryItem = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), text, speakerId, emotion, ts: new Date().toISOString(), vec };
  await tx("readwrite", (s) => s.put(item));
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/** Top-k for this speaker (vectors are normalized, so dot = cosine). */
export function rankMemories(items: MemoryItem[], q: number[], speakerId: string, k = 4, min = 0.3): MemoryItem[] {
  return items
    .filter((m) => m.speakerId === speakerId)
    .map((m) => ({ m, sim: dot(m.vec, q) }))
    .filter((x) => x.sim >= min)
    // ranked: relevance first, gently boosted by recency (30-day half-life) and emotional weight
    .map(({ m, sim }) => {
      const days = Math.max(0, (Date.now() - Date.parse(m.ts)) / 86400000);
      const recency = Math.pow(0.5, days / 30);
      const feeling = m.emotion && m.emotion !== "neutral" ? 0.03 : 0;
      return { m, s: sim + 0.08 * recency + feeling };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.m);
}

export async function queryMemories(text: string, speakerId: string, k = 4): Promise<MemoryItem[]> {
  const [q, items] = await Promise.all([embedText(text), listMemories()]);
  return rankMemories(items, q, speakerId, k);
}

export function summarizeExchange(user: string, reply: string, who: string): string {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() + "…" : s);
  return `${who || "User"} said: "${cut(user, 200)}" — Wilson replied: "${cut(reply.replace(/\s+/g, " "), 200)}"`;
}
