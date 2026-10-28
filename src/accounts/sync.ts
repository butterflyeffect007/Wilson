/**
 * Chat sync for signed-in accounts. Local storage stays the source of truth for the UI;
 * the server keeps a copy so chats come back on any device. Signed-out chats never leave the device.
 */
import type { StoredThread, StoredMessage } from "../memory/LocalMemory";
import { api } from "./api";
import { getToken, getUser } from "./store";

type Meta = { uid: string; since: number; sent: Record<string, string>; dels: string[] };
const KEY = "wilson_sync_meta";
export type RemoteChat = { id: string; updated_at: number; srv_at: number; deleted: boolean; thread: StoredThread | null };

function loadMeta(uid: string): Meta {
  try { const m = JSON.parse(localStorage.getItem(KEY) || "null") as Meta | null; if (m && m.uid === uid) return m; } catch { /* ignore */ }
  return { uid, since: 0, sent: {}, dels: [] };
}
function saveMeta(m: Meta) { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* full */ } }

const last = (t: StoredThread) => t.messages[t.messages.length - 1];
export const sig = (t: StoredThread) => { const l = last(t); return `${t.title}|${t.messages.length}|${l?.id ?? ""}|${l?.content.length ?? 0}`; };
export const updatedAt = (t: StoredThread) => Date.parse(last(t)?.timestamp || t.createdAt) || 0;
const worthSyncing = (t: StoredThread) => t.messages.some((m) => m.role === "user");

function mergeThread(a: StoredThread, b: StoredThread): StoredThread {
  const byId = new Map<string, StoredMessage>();
  for (const m of a.messages) byId.set(m.id, m);
  for (const m of b.messages) if (!byId.has(m.id) || (byId.get(m.id)!.content.length < m.content.length)) byId.set(m.id, m);
  const messages = [...byId.values()].sort((x, y) => (Date.parse(x.timestamp) || 0) - (Date.parse(y.timestamp) || 0));
  const newer = updatedAt(b) > updatedAt(a) ? b : a;
  return { ...newer, messages };
}

/** Pure: fold remote changes into the current local list (used inside setThreads). */
export function applyRemote(prev: StoredThread[], changes: RemoteChat[]): StoredThread[] {
  if (!changes.length) return prev;
  const map = new Map(prev.map((t) => [t.id, t]));
  for (const c of changes) {
    const local = map.get(c.id);
    if (c.deleted) { if (local && updatedAt(local) <= c.srv_at) map.delete(c.id); continue; }
    if (!c.thread || !Array.isArray(c.thread.messages)) continue;
    map.set(c.id, local ? mergeThread(local, c.thread) : c.thread);
  }
  return [...map.values()].sort((x, y) => updatedAt(y) - updatedAt(x));
}

let busy = false;
/** Fetch everything that changed on the server since the last pull. */
export async function pullRemote(): Promise<RemoteChat[]> {
  const u = getUser(); if (!u || !getToken() || busy) return [];
  busy = true;
  try {
    const meta = loadMeta(u.id); const out: RemoteChat[] = [];
    for (let i = 0; i < 20; i++) {
      const d = await api<{ now: number; chats: RemoteChat[]; more: boolean }>(`/acct/chats?since=${meta.since}`);
      out.push(...d.chats);
      for (const c of d.chats) { if (c.thread) meta.sent[c.id] = sig(c.thread); else delete meta.sent[c.id]; }
      meta.since = d.chats.length ? Math.max(meta.since, ...d.chats.map((c) => c.srv_at)) : Math.max(meta.since, d.now - 5000);
      if (!d.more) break;
    }
    saveMeta(meta); return out;
  } finally { busy = false; }
}

let pushing = false;
/** Upload threads whose content changed since they were last sent, plus deletions. */
export async function pushChanges(threads: StoredThread[]): Promise<{ saved: number } | null> {
  const u = getUser(); if (!u || !getToken() || pushing) return null;
  pushing = true;
  try {
    const meta = loadMeta(u.id);
    const ups = threads.filter((t) => worthSyncing(t) && meta.sent[t.id] !== sig(t));
    const dels = meta.dels.slice();
    if (!ups.length && !dels.length) return { saved: 0 };
    let saved = 0;
    for (let i = 0; i < Math.max(ups.length, 1); i += 20) {
      const batch = ups.slice(i, i + 20);
      await api("/acct/chats", { method: "PUT", body: { upserts: batch.map((t) => ({ id: t.id, updated_at: updatedAt(t), thread: t })), deletes: i === 0 ? dels : [] } });
      for (const t of batch) meta.sent[t.id] = sig(t);
      saved += batch.length;
    }
    meta.dels = meta.dels.filter((x) => !dels.includes(x));
    saveMeta(meta); return { saved };
  } catch { return null; } finally { pushing = false; }
}

export function noteDeleted(id: string) {
  const u = getUser(); if (!u) return;
  const meta = loadMeta(u.id); delete meta.sent[id];
  if (!meta.dels.includes(id)) meta.dels.push(id);
  saveMeta(meta);
}
