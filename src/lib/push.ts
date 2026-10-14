/** Web Push opt-in (per device). Public VAPID key only; the private key lives in the worker. */
import { WILSON_PROXY_URL } from "../App";
import { storedAdminKey, cachedIsAdmin } from "./admin";
import { loadReminders } from "./organizer";

export const VAPID_PUBLIC_KEY = "BHj10bsmvEh02S6JTgBT2JJoMI4WvUNG1bKQyY6BLP5_-HD5-M4f_3l0N8DVqwFeUBZ3SEIrbj2GDBiKjV6L8x8";
const ID = "wilson_push_id";

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const pushDeviceId = () => { try { return localStorage.getItem(ID); } catch { return null; } };
export const pushEnabled = () => !!pushDeviceId() && pushSupported() && Notification.permission === "granted";

const toKey = (b64: string) => { const s = b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const post = (path: string, body: unknown, auth = false) => fetch(`${WILSON_PROXY_URL}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(auth && cachedIsAdmin() ? { Authorization: `Bearer ${storedAdminKey()}` } : {}) },
  body: JSON.stringify(body),
});

/** Must be called from a tap (iOS requires a user gesture). Returns an error message or null. */
export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "On iPhone, add Wilson to your Home Screen first (Share → Add to Home Screen), then open it from there." : "This browser can't do notifications.";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Notifications are turned off for Wilson. You can allow them in your phone's settings.";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(VAPID_PUBLIC_KEY) }));
    const r = await post("/push/subscribe", { id: pushDeviceId(), subscription: sub.toJSON() }, true);
    if (!r.ok) return "Couldn't reach Wilson — try again in a moment.";
    const d = await r.json();
    localStorage.setItem(ID, d.id);
    await syncReminders();
    return null;
  } catch (e) { console.warn("[push]", e); return "Couldn't turn on notifications — try again."; }
}

export async function disablePush() {
  const id = pushDeviceId();
  try { localStorage.removeItem(ID); } catch { /* ignore */ }
  try { const reg = await navigator.serviceWorker.ready; await (await reg.pushManager.getSubscription())?.unsubscribe(); } catch { /* ignore */ }
  if (id) await post("/push/unsubscribe", { id }).catch(() => {});
}

/** Send upcoming reminder times + short text to the worker so they arrive even when Wilson is closed. */
export async function syncReminders() {
  const id = pushDeviceId();
  if (!id) return;
  const now = Date.now();
  const reminders = loadReminders()
    .filter((r) => !r.done && r.due && Date.parse(r.due) > now)
    .map((r) => ({ rid: r.id, due: r.due, text: r.text.slice(0, 80) }));
  try { await post("/push/reminders", { id, reminders }); } catch { /* offline: retried on next change/open */ }
}

let t: number | undefined;
/** Re-sync (debounced) whenever reminders change, and on open. */
export function startReminderSync() {
  const kick = () => { if (!pushDeviceId()) return; clearTimeout(t); t = window.setTimeout(() => void syncReminders(), 1500); };
  window.addEventListener("wilson-organizer", kick);
  window.addEventListener("online", kick);
  kick();
  return () => { window.removeEventListener("wilson-organizer", kick); window.removeEventListener("online", kick); };
}
