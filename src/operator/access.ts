import { cachedIsAdmin } from "../lib/admin";
import { isE2EArchitect } from "../terminal/access";

/** Operator runs on the Architect's device (it spends her search quota and browser minutes). */
export function canOpenOperator(isAdmin: boolean): boolean {
  return isAdmin || cachedIsAdmin() || isE2EArchitect();
}

function route(): string {
  try { return location.hash.replace(/^#\/?/, "").split(/[?&]/)[0]; } catch { return ""; }
}

export function operatorHashOpen(): boolean { return route() === "operator"; }

/** Optional goal passed in the hash: #operator?goal=... */
export function operatorGoalFromHash(): string {
  try {
    const q = location.hash.split("?")[1] || "";
    return (new URLSearchParams(q).get("goal") || "").slice(0, 600);
  } catch { return ""; }
}

export function openOperatorHash(goal?: string): void {
  try { location.hash = goal ? `#operator?goal=${encodeURIComponent(goal.slice(0, 600))}` : "#operator"; } catch { /* ignore */ }
}

export function closeOperatorHash(): void {
  try {
    if (!operatorHashOpen()) return;
    history.replaceState(null, "", location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } catch { /* ignore */ }
}
