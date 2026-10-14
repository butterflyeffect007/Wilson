/** Share Wilson (the app) + referral stars. Code is a random per-device id; no personal data. */
import { WILSON_PROXY_URL } from "../App";
import { anonId } from "./beta";
const CODE = "wilson_ref_code", SEEN = "wilson_ref_stars_seen", FROM = "wilson_ref_from";
const APP_URL = "https://butterflyeffect007.github.io/Wilson/";

export function refCode(): string {
  let c = localStorage.getItem(CODE);
  if (!c) { c = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); localStorage.setItem(CODE, c); }
  return c;
}
const post = (path: string, body: object) => fetch(`${WILSON_PROXY_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Returns current star count (null offline). */
export async function syncStars(shared = false): Promise<number | null> {
  try {
    const r = await post("/ref/me", { ref: refCode(), anon: anonId(), shared });
    if (r.status === 409) { localStorage.removeItem(CODE); return syncStars(shared); } // astronomically rare collision
    if (!r.ok) return null;
    return (await r.json()).stars ?? 0;
  } catch { return null; }
}
export const starsSeen = () => Number(localStorage.getItem(SEEN)) || 0;
export const markStarsSeen = (n: number) => localStorage.setItem(SEEN, String(n));

/** Friend side: credit the sharer once when the app is opened from their link. */
export async function creditReferral(ref: string) {
  if (!/^[a-z0-9]{10}$/.test(ref) || ref === localStorage.getItem(CODE) || localStorage.getItem(FROM)) return;
  localStorage.setItem(FROM, ref);
  try { await post("/ref/open", { ref, anon: anonId() }); } catch { /* offline */ }
}

/** Native share sheet; falls back to copying. Returns what happened. */
export async function shareApp(isBeta: boolean): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const link = `${APP_URL}?ref=${refCode()}${isBeta ? "&beta=1" : ""}`;
  const text = "I've been talking with Wilson — a warm, kind of brilliant AI companion who actually gets you. Free, no sign-up. Come meet him ✦";
  try {
    if (navigator.share) { await navigator.share({ title: "Wilson", text, url: link }); void syncStars(true); return "shared"; }
    await navigator.clipboard.writeText(`${text}\n${link}`); void syncStars(true); return "copied";
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return "cancelled";
    try { await navigator.clipboard.writeText(link); void syncStars(true); return "copied"; } catch { return "failed"; }
  }
}
