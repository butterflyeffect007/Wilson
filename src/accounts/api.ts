/** Wilson accounts API (worker /acct, /room, /arch). Errors come back as { error } with a friendly message. */
import { WILSON_PROXY_URL } from "../App";
import { getToken } from "./store";

export type AcctUser = { id: string; username: string; email: string; architect: boolean; beta: boolean; room_blocked: boolean; created_at: number };
export type Flags = { signups_open: boolean; room_open: boolean; wilson_in_room: boolean; beta_open: boolean; voice_for_all: boolean; maintenance: boolean; slow_mode: boolean };
export type Banner = { text: string; until: number; at: number } | null;

export class ApiError extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status; } }

export async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let token = opts.token === undefined ? getToken() : opts.token;
  // Legacy Architect key (from before accounts) still opens the dashboard.
  if (!token && opts.token === undefined && path.startsWith("/arch/")) { try { token = localStorage.getItem("wilson_architect_key"); } catch { /* ignore */ } }
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let r: Response;
  try {
    r = await fetch(`${WILSON_PROXY_URL}${path}`, { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch { throw new ApiError(navigator.onLine ? "Couldn't reach Wilson — try again in a moment." : "You're offline — try again when you're back online.", 0); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError((d as { error?: string }).error || `Something went wrong (${r.status}).`, r.status);
  return d as T;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
