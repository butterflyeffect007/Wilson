import { WILSON_PROXY_URL } from "../App";
import { cachedIsAdmin, storedAdminKey } from "../lib/admin";
import type { JobCard, JobsState } from "./types";

const KEY = "wilson_jobs_state";

export function loadJobsState(): JobsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { saved: [], dismissed: [] };
    const s = JSON.parse(raw) as JobsState;
    return {
      saved: Array.isArray(s.saved) ? s.saved : [],
      dismissed: Array.isArray(s.dismissed) ? s.dismissed : [],
      lastHuntAt: typeof s.lastHuntAt === "string" ? s.lastHuntAt : undefined,
    };
  } catch {
    return { saved: [], dismissed: [] };
  }
}

export function saveJobsState(state: JobsState): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  void syncJobsState(state);
}

async function syncJobsState(state: JobsState): Promise<void> {
  if (!cachedIsAdmin()) return;
  try {
    await fetch(`${WILSON_PROXY_URL}/admin/jobs/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${storedAdminKey()}` },
      body: JSON.stringify({ state }),
    });
  } catch { /* sync is optional until the worker is deployed */ }
}

export async function pullJobsState(): Promise<JobsState | null> {
  if (!cachedIsAdmin()) return null;
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/admin/jobs/state`, {
      headers: { Authorization: `Bearer ${storedAdminKey()}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.state || null;
  } catch {
    return null;
  }
}

export function upsertSaved(state: JobsState, card: JobCard): JobsState {
  const rest = state.saved.filter((c) => c.id !== card.id && c.url !== card.url);
  const next = { ...state, saved: [{ ...card, savedAt: card.savedAt || new Date().toISOString() }, ...rest] };
  saveJobsState(next);
  return next;
}

export function dismissCard(state: JobsState, card: JobCard): JobsState {
  const id = card.id;
  const next = {
    ...state,
    saved: state.saved.filter((c) => c.id !== id),
    dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id],
  };
  saveJobsState(next);
  return next;
}

export function huntedToday(iso?: string): boolean {
  if (!iso) return false;
  try {
    const a = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    const b = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return a === b;
  } catch {
    return false;
  }
}
