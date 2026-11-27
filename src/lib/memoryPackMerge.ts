/**
 * Pure merge for a signed-in memory pack. No storage, no network.
 */
export interface PackLesson { id: string; text: string; ts: string }
export interface PackFact { id: string; text: string; speakerId: string; emotion: string | null; ts: string }
export interface PackStateOfYou {
  summary: string;
  vibes: { v: string; ts: number }[];
  turns: { ts: number; len: number }[];
  pending: number;
  updatedAt: number | null;
  editedByUser?: boolean;
}
export interface PackQuiet {
  intent: string;
  pacing: string[];
  threads: { id: string; title: string; status: string; next: string; decision: string; date: string }[];
  recaps: { id: string; date: string; text: string }[];
  updatedAt: number;
}
export interface MemoryPack {
  updatedAt: number;
  lessons: PackLesson[];
  stateOfYou: PackStateOfYou;
  quietMemory: PackQuiet;
  facts: PackFact[];
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeLessons(a: PackLesson[], b: PackLesson[]): PackLesson[] {
  const map = new Map<string, PackLesson>();
  for (const l of [...a, ...b]) {
    const text = (l?.text || "").trim();
    if (!text) continue;
    const key = norm(text);
    const prev = map.get(key);
    if (!prev) map.set(key, { id: l.id || key, text, ts: l.ts });
    else if (String(l.ts) > String(prev.ts)) map.set(key, { id: prev.id || l.id || key, text: prev.text, ts: l.ts });
  }
  return [...map.values()].sort((x, y) => String(x.ts).localeCompare(String(y.ts))).slice(-60);
}

function mergeFacts(a: PackFact[], b: PackFact[]): PackFact[] {
  const byId = new Map<string, PackFact>();
  const byText = new Map<string, string>();
  const add = (f: PackFact) => {
    const text = (f?.text || "").trim();
    if (!text) return;
    const id = f.id || "";
    const key = norm(text);
    if (id && byId.has(id)) {
      const prev = byId.get(id)!;
      if (String(f.ts) > String(prev.ts)) byId.set(id, { ...prev, ...f, text });
      return;
    }
    const existingId = byText.get(key);
    if (existingId) {
      const prev = byId.get(existingId)!;
      if (String(f.ts) > String(prev.ts)) byId.set(existingId, { ...prev, ...f, id: existingId, text });
      return;
    }
    const useId = id || `f${byId.size}`;
    byId.set(useId, { id: useId, text, speakerId: f.speakerId || "default", emotion: f.emotion ?? null, ts: f.ts });
    byText.set(key, useId);
  };
  for (const f of [...a, ...b]) add(f);
  return [...byId.values()].sort((x, y) => String(x.ts || "").localeCompare(String(y.ts || ""))).slice(-200);
}

function mergeState(a: PackStateOfYou, b: PackStateOfYou): PackStateOfYou {
  const aAt = a.updatedAt || 0;
  const bAt = b.updatedAt || 0;
  const newer = bAt >= aAt ? b : a;
  const older = newer === b ? a : b;
  const vibeKey = new Set((newer.vibes || []).map((v) => `${v.ts}:${v.v}`));
  const turnKey = new Set((newer.turns || []).map((t) => `${t.ts}:${t.len}`));
  const vibes = [...(newer.vibes || [])];
  const turns = [...(newer.turns || [])];
  for (const v of older.vibes || []) if (!vibeKey.has(`${v.ts}:${v.v}`)) vibes.push(v);
  for (const t of older.turns || []) if (!turnKey.has(`${t.ts}:${t.len}`)) turns.push(t);
  return {
    ...newer,
    pending: Math.max(a.pending || 0, b.pending || 0),
    vibes: vibes.sort((x, y) => x.ts - y.ts).slice(-200),
    turns: turns.sort((x, y) => x.ts - y.ts).slice(-400),
  };
}

function mergeQuiet(a: PackQuiet, b: PackQuiet): PackQuiet {
  const aAt = a.updatedAt || 0;
  const bAt = b.updatedAt || 0;
  const newer = bAt >= aAt ? b : a;
  const older = newer === b ? a : b;
  const byTitle = new Map<string, PackQuiet["threads"][number]>();
  for (const t of [...older.threads, ...newer.threads]) {
    const key = (t.title || "").trim().toLowerCase();
    if (!key) continue;
    const prev = byTitle.get(key);
    if (!prev) { byTitle.set(key, t); continue; }
    byTitle.set(key, (t.date || "") >= (prev.date || "") ? t : prev);
  }
  const recapIds = new Map<string, PackQuiet["recaps"][number]>();
  for (const r of [...older.recaps, ...newer.recaps]) {
    const key = r.id || `${r.date}:${r.text}`;
    if (!recapIds.has(key)) recapIds.set(key, r);
  }
  return {
    intent: newer.intent || older.intent,
    pacing: (newer.pacing.length ? newer.pacing : older.pacing).slice(0, 6),
    threads: [...byTitle.values()].slice(0, 8),
    recaps: [...recapIds.values()].sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 5),
    updatedAt: Math.max(aAt, bAt),
  };
}

export function mergePacks(a: MemoryPack, b: MemoryPack): MemoryPack {
  return {
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
    lessons: mergeLessons(a.lessons || [], b.lessons || []),
    stateOfYou: mergeState(a.stateOfYou, b.stateOfYou),
    quietMemory: mergeQuiet(a.quietMemory, b.quietMemory),
    facts: mergeFacts(a.facts || [], b.facts || []),
  };
}
