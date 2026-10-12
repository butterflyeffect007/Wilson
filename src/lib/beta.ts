/** Founding beta + feedback pipeline (worker /beta/join, /report). No signups, anon id only. */
import { WILSON_PROXY_URL } from "../App";
export const APP_VERSION = "1.1.0-beta";
const ANON_KEY = "wilson_anon_id";
const NUM_KEY = "wilson_beta_number";

export function anonId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(ANON_KEY, id); }
  return id;
}
export const betaNumber = (): number | null => Number(localStorage.getItem(NUM_KEY)) || null;

export async function joinBeta(): Promise<number | "full" | null> {
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/beta/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anon: anonId() }) });
    const d = await r.json();
    if (d.full) return "full";
    if (d.number) { localStorage.setItem(NUM_KEY, String(d.number)); return d.number; }
  } catch { /* offline */ }
  return null;
}

export type FeedbackType = "problem" | "suggestion" | "great";
export async function sendFeedback(f: { type: FeedbackType; message: string; reply?: string; context?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/report`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f, version: APP_VERSION, beta: betaNumber(),
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        device: `${navigator.userAgent} · ${window.innerWidth}x${window.innerHeight} · standalone=${matchMedia("(display-mode: standalone)").matches}`,
      }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: d.error || "Couldn't send" };
  } catch { return { ok: false, error: "You're offline — try again soon." }; }
}
