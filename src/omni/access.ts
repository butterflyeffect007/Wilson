import { cachedIsAdmin } from "../lib/admin";
import { isE2EArchitect } from "../terminal/access";

export function isE2EOmni(): boolean {
  try {
    const host = location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return false;
    return /(?:^|[?&])e2e_omni=1(?:&|$)/.test(location.search) || isE2EArchitect();
  } catch {
    return false;
  }
}

export function canOpenOmni(isAdmin: boolean): boolean {
  return isAdmin || cachedIsAdmin() || isE2EArchitect() || isE2EOmni();
}

export function omniHashOpen(): boolean {
  try {
    return location.hash.replace(/^#\/?/, "").split(/[?&]/)[0] === "omni" || /(?:^|[?&])e2e_omni=1(?:&|$)/.test(location.search);
  } catch {
    return false;
  }
}

export function openOmniHash(): void {
  try { location.hash = "#omni"; } catch { /* ignore */ }
}

export function closeOmniHash(): void {
  try {
    if (omniHashOpen()) {
      history.replaceState(null, "", location.pathname + location.search);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  } catch { /* ignore */ }
}
