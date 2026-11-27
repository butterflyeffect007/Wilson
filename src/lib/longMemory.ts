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
const FACTS_KEY = "wilson_facts_v1";
let extractor: Promise<any> | null = null;

/** Text-only facts that sync with a signed-in account (no vectors). */
export type TextFact = { id: string; text: string; speakerId: string; emotion: string | null; ts: string };

export function loadTextFacts(): TextFact[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FACTS_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((f) => f && typeof f.text === "string") : [];
  } catch { return []; }
}
export function saveTextFacts(facts: TextFact[]): void {
  try { localStorage.setItem(FACTS_KEY, JSON.stringify(facts.slice(-200))); } catch { /* quota */ }
}
export function replaceTextFacts(facts: TextFact[]): void {
  saveTextFacts(facts);
}
export function recordTextFact(fact: TextFact): void {
  const cur = loadTextFacts().filter((f) => f.id !== fact.id && f.text.toLowerCase() !== fact.text.toLowerCase());
  saveTextFacts([...cur, fact]);
}
export function forgetTextFact(id: string): void {
  saveTextFacts(loadTextFacts().filter((f) => f.id !== id));
}
export function clearTextFacts(): void {
  try { localStorage.removeItem(FACTS_KEY); } catch { /* ignore */ }
}

/** Same speaker, or the default typed-memory bucket (voice ids don't travel across devices). */
export function speakerMatch(itemSpeaker: string, querySpeaker: string): boolean {
  const a = itemSpeaker || "default";
  const b = querySpeaker || "default";
  return a === b || a === "default" || b === "default";
}

const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "that", "this", "with", "you", "we", "i", "me", "my", "was", "be"]);
function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9']+/i).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Keyword + recency rank — works on iPhone without loading the embedding model. */
export function rankMemoriesText(items: { id: string; text: string; speakerId: string; emotion: string | null; ts: string }[], q: string, speakerId: string, k = 4): typeof items {
  const qt = tokens(q);
  if (!qt.length) {
    return items.filter((m) => speakerMatch(m.speakerId, speakerId)).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, k);
  }
  const scored = items
    .filter((m) => speakerMatch(m.speakerId, speakerId))
    .map((m) => {
      const mt = new Set(tokens(m.text));
      const hits = qt.filter((w) => mt.has(w)).length;
      const days = Math.max(0, (Date.now() - Date.parse(m.ts)) / 86400000);
      const recency = Math.pow(0.5, days / 30);
      const feeling = m.emotion && m.emotion !== "neutral" ? 0.03 : 0;
      return { m, s: hits + 0.08 * recency + feeling };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.m);
  return scored;
}

function extractorReady(): boolean {
  return !!extractor;
}

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

export const listMemories = async (): Promise<MemoryItem[]> => {
  let idb: MemoryItem[] = [];
  try { idb = await tx<MemoryItem[]>("readonly", (s) => s.getAll() as IDBRequest<MemoryItem[]>); } catch { /* ignore */ }
  const byId = new Map<string, MemoryItem>();
  for (const f of loadTextFacts()) byId.set(f.id, { ...f, vec: [] });
  for (const m of idb) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()];
};
export const deleteMemory = async (id: string) => {
  forgetTextFact(id);
  try { window.dispatchEvent(new Event("wilson-memory-pack-dirty")); } catch { /* ignore */ }
  await tx("readwrite", (s) => s.delete(id));
};
export const clearMemories = async () => {
  clearTextFacts();
  try { window.dispatchEvent(new Event("wilson-memory-pack-dirty")); } catch { /* ignore */ }
  await tx("readwrite", (s) => s.clear());
};

export async function upsertMemory(text: string, speakerId: string, emotion: string | null): Promise<void> {
  const item: MemoryItem = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), text, speakerId, emotion, ts: new Date().toISOString(), vec: [] };
  recordTextFact(item);
  try { window.dispatchEvent(new Event("wilson-memory-pack-dirty")); } catch { /* ignore */ }
  try {
    item.vec = await embedText(text);
    await tx("readwrite", (s) => s.put(item));
  } catch { /* text fact is enough; vectors can catch up later */ }
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/** Top-k for this speaker (vectors are normalized, so dot = cosine). */
export function rankMemories(items: MemoryItem[], q: number[], speakerId: string, k = 4, min = 0.3): MemoryItem[] {
  return items
    .filter((m) => speakerMatch(m.speakerId, speakerId))
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
  const facts = loadTextFacts();
  let idb: MemoryItem[] = [];
  try { idb = await listMemories(); } catch { /* private mode / idb blocked */ }
  const byId = new Map<string, MemoryItem>();
  for (const f of facts) byId.set(f.id, { ...f, vec: [] });
  for (const m of idb) byId.set(m.id, { ...byId.get(m.id), ...m, text: m.text || byId.get(m.id)?.text || "" });
  const items = [...byId.values()];
  const textHits = rankMemoriesText(items, text, speakerId, k) as MemoryItem[];
  // On iPhone, don't start the embedding model mid-send (it fights Puck). Use it only if already loaded.
  if (!extractorReady()) return textHits;
  try {
    const q = await embedText(text);
    const withVec = items.filter((m) => Array.isArray(m.vec) && m.vec.length);
    if (withVec.length) {
      const ranked = rankMemories(withVec, q, speakerId, k);
      if (ranked.length) return ranked;
    }
  } catch { /* keep text hits */ }
  return textHits;
}

export function summarizeExchange(user: string, reply: string, who: string): string {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() + "…" : s);
  return `${who || "User"} said: "${cut(user, 200)}" — Wilson replied: "${cut(reply.replace(/\s+/g, " "), 200)}"`;
}
