/** Account session on this device. Token lives in localStorage ("keep me signed in") or sessionStorage. */
import type { AcctUser } from "./api";

const TOK = "wilson_acct_token", USER = "wilson_acct_user";
type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((f) => f());
export const subscribeAccount = (f: Listener) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function getToken(): string | null {
  try { return sessionStorage.getItem(TOK) || localStorage.getItem(TOK); } catch { return null; }
}
export function getUser(): AcctUser | null {
  try { const s = sessionStorage.getItem(USER) || localStorage.getItem(USER); return s ? JSON.parse(s) : null; } catch { return null; }
}

/** Architect accounts double as the Architect key, so every existing Architect feature (stats, nightly notes) works when Jenny signs in. */
function syncArchitect(token: string | null, user: AcctUser | null) {
  try {
    const cur = localStorage.getItem("wilson_architect_key") || "";
    if (token && user?.architect) { localStorage.setItem("wilson_architect_key", token); localStorage.setItem("wilson_is_admin", "1"); }
    else if (cur.startsWith("wsess_")) { localStorage.removeItem("wilson_architect_key"); localStorage.removeItem("wilson_is_admin"); }
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("wilson-architect-changed", { detail: !!(token && user?.architect) }));
}

export function setSession(token: string, user: AcctUser, keep: boolean) {
  try {
    localStorage.removeItem(TOK); localStorage.removeItem(USER); sessionStorage.removeItem(TOK); sessionStorage.removeItem(USER);
    const s = keep ? localStorage : sessionStorage;
    s.setItem(TOK, token); s.setItem(USER, JSON.stringify(user));
  } catch { /* ignore */ }
  syncArchitect(token, user); emit();
}
export function updateUser(user: AcctUser) {
  try { const s = sessionStorage.getItem(TOK) ? sessionStorage : localStorage; s.setItem(USER, JSON.stringify(user)); } catch { /* ignore */ }
  syncArchitect(getToken(), user); emit();
}
export function clearSession() {
  try { localStorage.removeItem(TOK); localStorage.removeItem(USER); sessionStorage.removeItem(TOK); sessionStorage.removeItem(USER); localStorage.removeItem("wilson_sync_meta"); } catch { /* ignore */ }
  syncArchitect(null, null); emit();
}
