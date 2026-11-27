/** Pure Architect-cache checks (no network, safe to unit-test). */
export const ADMIN_KEY_STORE = "wilson_architect_key";
export const ADMIN_FLAG_STORE = "wilson_is_admin";
export const ADMIN_VERIFIED_AT_STORE = "wilson_admin_verified_at";
/** How long a prior successful server check still counts if the phone is briefly offline. */
export const ADMIN_VERIFY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function hasServerVerifiedAdmin(store: { getItem(k: string): string | null }): boolean {
  try {
    if (store.getItem(ADMIN_FLAG_STORE) !== "1" || !store.getItem(ADMIN_KEY_STORE)) return false;
    const at = Number(store.getItem(ADMIN_VERIFIED_AT_STORE) || 0);
    if (!Number.isFinite(at) || at <= 0) return true; // legacy install on this phone, already had the key
    return Date.now() - at < ADMIN_VERIFY_MAX_AGE_MS;
  } catch {
    return false;
  }
}
