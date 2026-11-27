/**
 * Pull/push the signed-in memory pack via /acct/memory.
 * If the worker does not have the route yet (404), fail quietly and keep the local copy.
 */
import { api, ApiError } from "./api";
import { getToken, getUser } from "./store";
import { pullArchitectMemory, loadQuietMemory, applyQuietMemory } from "../lib/quietMemory";
import {
  MEMORY_PACK_EVENT,
  applyLocalPack,
  gatherLocalPack,
  mergePacks,
  type MemoryPack,
} from "../lib/memoryPack";

const UID_KEY = "wilson_memory_pack_uid";
const STASH_PREFIX = "wilson_memory_stash:";

function currentUid(): string | null {
  return getUser()?.id || null;
}

function savedUid(): string | null {
  try { return localStorage.getItem(UID_KEY); } catch { return null; }
}
function setSavedUid(id: string | null) {
  try { if (id) localStorage.setItem(UID_KEY, id); else localStorage.removeItem(UID_KEY); } catch { /* ignore */ }
}

function stashLocal(uid: string, pack: MemoryPack) {
  try { localStorage.setItem(STASH_PREFIX + uid, JSON.stringify(pack)); } catch { /* quota */ }
}
function loadStash(uid: string): MemoryPack | null {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + uid);
    return raw ? JSON.parse(raw) as MemoryPack : null;
  } catch { return null; }
}

let applying = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

async function getRemote(): Promise<MemoryPack | null> {
  if (!getToken()) return null;
  try {
    const d = await api<{ memory: MemoryPack | null; updated_at: number }>("/acct/memory");
    return d.memory || null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401)) return null;
    throw e;
  }
}

async function putRemote(pack: MemoryPack): Promise<MemoryPack | "ok" | null> {
  if (!getToken()) return null;
  try {
    const d = await api<{ ok: boolean; stale?: boolean; memory?: MemoryPack; updated_at: number }>("/acct/memory", {
      method: "PUT",
      body: { memory: pack, updated_at: pack.updatedAt },
    });
    if (d.stale && d.memory) return d.memory;
    return "ok";
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401)) return null;
    throw e;
  }
}

/** Pull the account pack (and Architect quiet-memory fallback), merge, write locally, push if we were newer. */
export async function pullMemoryPack(): Promise<"ok" | "unavailable" | "error"> {
  if (!getToken()) return "unavailable";
  const uid = currentUid();
  if (!uid) return "unavailable";
  try {
    const prevUid = savedUid();
    let local = gatherLocalPack();
    if (prevUid && prevUid !== uid) {
      stashLocal(prevUid, local);
      const stashed = loadStash(uid);
      local = stashed || { ...local, lessons: [], facts: [], stateOfYou: { ...local.stateOfYou, summary: "", pending: 0, vibes: [], turns: [], updatedAt: null }, quietMemory: { intent: "", pacing: [], threads: [], recaps: [], updatedAt: 0 }, updatedAt: 0 };
    } else if (!prevUid) {
      // First time this browser is linking memory to an account: keep local and attach the uid.
    }
    setSavedUid(uid);

    let remote: MemoryPack | null = null;
    try { remote = await getRemote(); } catch { return "error"; }
    // Architect fallback: older quiet memory lives at /admin/memory.
    try {
      await pullArchitectMemory();
      const adminQ = loadQuietMemory();
      if (adminQ.updatedAt && (!remote || (adminQ.updatedAt > (remote.quietMemory?.updatedAt || 0)))) {
        if (remote) remote = { ...remote, quietMemory: adminQ, updatedAt: Math.max(remote.updatedAt || 0, adminQ.updatedAt) };
      }
      if (!remote && adminQ.updatedAt) {
        remote = { ...local, quietMemory: adminQ, updatedAt: Math.max(local.updatedAt || 0, adminQ.updatedAt) };
      }
    } catch { /* ignore */ }

    applying = true;
    try {
      if (remote) {
        const merged = mergePacks(local, remote);
        applyLocalPack(merged, true);
        if ((local.updatedAt || 0) > (remote.updatedAt || 0) || JSON.stringify(merged.lessons) !== JSON.stringify(remote.lessons || [])) {
          await putRemote(merged).catch(() => null);
        }
      } else if ((local.lessons.length || local.facts.length || local.quietMemory.updatedAt || local.stateOfYou.updatedAt) && prevUid !== uid && prevUid) {
        // Switched accounts and server is empty: don't upload the previous person's data (already stashed).
        applyLocalPack(local, true);
      } else if (local.lessons.length || local.facts.length || local.quietMemory.updatedAt || local.stateOfYou.updatedAt) {
        await putRemote(local).catch(() => null);
      }
    } finally { applying = false; }
    return remote === null && !getToken() ? "unavailable" : "ok";
  } catch {
    applying = false;
    return "error";
  }
}

export async function pushMemoryPack(): Promise<"ok" | "unavailable" | "error"> {
  if (!getToken() || applying) return "unavailable";
  const uid = currentUid();
  if (!uid) return "unavailable";
  const prev = savedUid();
  if (prev && prev !== uid) return "unavailable";
  if (!prev) setSavedUid(uid);
  try {
    const pack = gatherLocalPack();
    const result = await putRemote(pack);
    if (result && result !== "ok") {
      applying = true;
      try { applyLocalPack(mergePacks(pack, result), true); } finally { applying = false; }
    }
    return result == null ? "unavailable" : "ok";
  } catch { return "error"; }
}

export function scheduleMemoryPush(): void {
  if (!getToken() || applying) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushMemoryPack(); }, 1600);
}

/** Listen once for local memory edits and debounce a signed-in push. */
export function startMemoryPackSync(): void {
  if (listening) return;
  listening = true;
  const onDirty = () => { if (!applying) scheduleMemoryPush(); };
  window.addEventListener(MEMORY_PACK_EVENT, onDirty);
}
