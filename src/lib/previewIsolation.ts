/**
 * Preview builds only (VITE_PREVIEW_ID is set by the "Preview PR" workflow, e.g. "pr-18").
 * A preview lives on the same site as the live Wilson (…/Wilson/preview/pr-N/), so it would share
 * localStorage with the live app. Here we give the preview its own copy: on first open it copies the
 * live values (read-only), and from then on every read/write goes to "wilson_preview_<id>:" keys.
 * The live app's data is never changed by a preview. Live builds skip all of this.
 *
 * Sign-ins are NEVER copied: account session tokens, the Architect key/flag, the GitHub token, the push id,
 * and anything else that looks like a credential stay with the live app only, so a preview starts signed
 * out (sign in inside the preview if you need to). Previews seeded by an older build get those copies
 * removed on their next open. (Same-origin previews can still technically reach live storage; the full fix
 * is serving previews from a separate address. See docs/preview-isolation.md.)
 */
/** Keys a preview must never receive from the live app. */
export const NEVER_COPY = new Set(["wilson_acct_token", "wilson_acct_user", "wilson_architect_key", "wilson_is_admin", "wilson_github_token", "wilson_push_id"]);
const SECRETISH = /(token|secret|passw|session|sess_|apikey|api_key|_key$|architect|admin|credential|auth)/i;
export const isSecretKey = (k: string): boolean => NEVER_COPY.has(k) || SECRETISH.test(k);
const SEED_VERSION = "2";
export const PREVIEW_ID: string = ((typeof import.meta.env === "object" ? (import.meta.env.VITE_PREVIEW_ID as string | undefined) : "") || "").trim();

export function installPreviewStorage(id: string, store: Storage, proto: Storage = Storage.prototype): void {
  const P = `wilson_preview_${id}:`;
  const get = proto.getItem, set = proto.setItem, rem = proto.removeItem, key = proto.key;
  const lenDesc = Object.getOwnPropertyDescriptor(proto, "length");
  const rawLen = (s: Storage): number => (lenDesc?.get ? lenDesc.get.call(s) : 0);
  const rawKeys = (s: Storage): string[] => {
    const out: string[] = [];
    for (let i = 0; i < rawLen(s); i++) { const k = key.call(s, i); if (k != null) out.push(k); }
    return out;
  };
  const seeded = get.call(store, P + "__seeded");
  if (seeded == null) {
    for (const k of rawKeys(store)) {
      if (k.startsWith("wilson_preview_") || isSecretKey(k)) continue;
      const v = get.call(store, k);
      if (v == null || v.length > 50_000) continue; // skip big blobs (chat logs) to stay under the quota
      try { set.call(store, P + k, v); } catch { /* quota: preview just starts with less */ }
    }
    try { set.call(store, P + "__seeded", SEED_VERSION); } catch { /* ignore */ }
  } else if (seeded !== SEED_VERSION) {
    // Seeded by an older build that copied sign-ins: drop those copies once (the live originals stay put).
    for (const k of rawKeys(store)) if (k.startsWith(P) && k !== P + "__seeded" && isSecretKey(k.slice(P.length))) rem.call(store, k);
    try { set.call(store, P + "__seeded", SEED_VERSION); } catch { /* ignore */ }
  }
  const mine = (s: Storage) => s === store;
  const ownKeys = (s: Storage) => rawKeys(s).filter((k) => k.startsWith(P) && k !== P + "__seeded").map((k) => k.slice(P.length));
  proto.getItem = function (this: Storage, k: string) { return get.call(this, mine(this) ? P + k : k); };
  proto.setItem = function (this: Storage, k: string, v: string) { return set.call(this, mine(this) ? P + k : k, v); };
  proto.removeItem = function (this: Storage, k: string) { return rem.call(this, mine(this) ? P + k : k); };
  proto.key = function (this: Storage, i: number) { return mine(this) ? (ownKeys(this)[i] ?? null) : key.call(this, i); };
  proto.clear = function (this: Storage) {
    if (!mine(this)) { for (const k of rawKeys(this)) rem.call(this, k); return; }
    for (const k of ownKeys(this)) rem.call(this, P + k);
  };
  Object.defineProperty(proto, "length", { configurable: true, get(this: Storage) { return mine(this) ? ownKeys(this).length : rawLen(this); } });
}

if (PREVIEW_ID && typeof window !== "undefined") {
  try { installPreviewStorage(PREVIEW_ID, window.localStorage); } catch { /* storage blocked: preview still runs */ }
  try {
    document.documentElement.dataset.wilsonPreview = PREVIEW_ID;
    const tag = document.createElement("div");
    tag.textContent = "Preview — not live yet";
    tag.setAttribute("style", "position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:max(8px,env(safe-area-inset-bottom));padding:6px 14px;border-radius:99px;font:500 13px Lexend,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#6E21B0,#D13BB2 55%,#EB7B59);box-shadow:0 0 16px rgba(209,59,178,.55);pointer-events:none");
    const add = () => document.body && document.body.appendChild(tag);
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  } catch { /* ignore */ }
}
