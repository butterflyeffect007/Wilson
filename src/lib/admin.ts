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
  beta: { count: number; limit: number; latest: { number: number; ts: string }[]; roster?: { number: number; ts: string }[] };
  reports: { count: number; recent: { id: string; type: string; ts: string; message: string; beta: number | null; issue: string | null }[] };
  usage: Record<string, Record<string, number>>;
  config: { chat: string; voice: string };
  referrals?: { shares: number; opens: number; sharers: number; top: { code: string; stars: number }[] };
};
export async function fetchTelemetry(): Promise<Telemetry | null> {
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/admin/telemetry`, { headers: { Authorization: `Bearer ${storedAdminKey()}` } });
    if (r.status === 401) forgetAdmin();
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/* ---------- Nightly notes (opt-in): sync open loops to the worker; read the daily note ---------- */
const SYNC = "wilson_nightly_sync", SEEN = "wilson_note_seen";
export const nightlyOptIn = () => { try { return localStorage.getItem(SYNC) === "1"; } catch { return false; } };
export function setNightlyOptIn(on: boolean) {
  try { if (on) localStorage.setItem(SYNC, "1"); else localStorage.removeItem(SYNC); } catch { /* ignore */ }
  if (!on) void fetch(`${WILSON_PROXY_URL}/admin/loops`, { method: "DELETE", headers: { Authorization: `Bearer ${storedAdminKey()}` } }).catch(() => {});
}
/** Only the "Grinding on" + "Open loops" parts leave the device. */
export function extractLoops(summary: string): string {
  const pick = (h: string) => { const m = summary.match(new RegExp(`${h}:?([\\s\\S]*?)(?=\\n[A-Z][\\w &]+:|$)`, "i")); return m ? m[1].trim() : ""; };
  const g = pick("Grinding on"), o = pick("Open loops");
  return [g && `Grinding on: ${g}`, o && `Open loops: ${o}`].filter(Boolean).join("\n").slice(0, 1500);
}
export async function syncLoops(summary: string) {
  if (!cachedIsAdmin() || !nightlyOptIn()) return;
  const text = extractLoops(summary);
  if (!text) return;
  try { await fetch(`${WILSON_PROXY_URL}/admin/loops`, { method: "POST", headers: { Authorization: `Bearer ${storedAdminKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); } catch { /* offline */ }
}
export async function fetchUnseenNote(): Promise<{ text: string; ts: string } | null> {
  if (!cachedIsAdmin() || !nightlyOptIn()) return null;
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/admin/note`, { headers: { Authorization: `Bearer ${storedAdminKey()}` } });
    const d = r.ok ? await r.json() : null;
    const n = d?.note;
    if (!n?.text || n.ts <= (localStorage.getItem(SEEN) || "")) return null;
    return { text: n.text, ts: n.ts };
  } catch { return null; }
}
export const markNoteSeen = (ts: string) => { try { localStorage.setItem(SEEN, ts); } catch { /* ignore */ } };
