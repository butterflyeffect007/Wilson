/** Architect (admin) access. The key lives only on Jenny's device after she enters it; the worker verifies it. */
import { WILSON_PROXY_URL } from "../App";
const KEY = "wilson_architect_key";
const FLAG = "wilson_is_admin";
export const storedAdminKey = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
export const cachedIsAdmin = () => { try { return localStorage.getItem(FLAG) === "1" && !!storedAdminKey(); } catch { return false; } };
export function forgetAdmin() { try { localStorage.removeItem(KEY); localStorage.removeItem(FLAG); } catch { /* ignore */ } }

/** Server check. Returns true/false, or null when offline (keep cached state). */
export async function verifyAdmin(key = storedAdminKey()): Promise<boolean | null> {
  if (!key) return false;
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/admin/check`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.status === 401) { forgetAdmin(); return false; }
    if (!r.ok) return null;
    localStorage.setItem(KEY, key); localStorage.setItem(FLAG, "1");
    return true;
  } catch { return null; }
}

export type Telemetry = {
  beta: { count: number; limit: number; latest: { number: number; ts: string }[] };
  reports: { count: number; recent: { id: string; type: string; ts: string; message: string; beta: number | null; issue: string | null }[] };
  usage: Record<string, Record<string, number>>;
  config: { chat: string; voice: string };
};
export async function fetchTelemetry(): Promise<Telemetry | null> {
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/admin/telemetry`, { headers: { Authorization: `Bearer ${storedAdminKey()}` } });
    if (r.status === 401) forgetAdmin();
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
