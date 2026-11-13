import { cachedIsAdmin } from "../lib/admin";
import { isE2EArchitect } from "../terminal/access";

export type E2EJobsScreen = "list" | "draft";

export function isE2EJobs(): E2EJobsScreen | null {
  try {
    const host = location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return null;
    const m = /(?:^|[?&])e2e_jobs=(list|draft)(?:&|$)/.exec(location.search);
    return (m?.[1] as E2EJobsScreen | undefined) || null;
  } catch {
    return null;
  }
}

export function canOpenJobs(isAdmin: boolean): boolean {
  return isAdmin || cachedIsAdmin() || isE2EArchitect();
}

export function jobsHashOpen(): boolean {
  try {
    return location.hash.replace(/^#\/?/, "").split(/[?&]/)[0] === "jobs" || !!isE2EJobs();
  } catch {
    return false;
  }
}

export function openJobsHash(): void {
  try { location.hash = "#jobs"; } catch { /* ignore */ }
}

export function closeJobsHash(): void {
  try {
    if (jobsHashOpen()) {
      history.replaceState(null, "", location.pathname + location.search);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  } catch { /* ignore */ }
}
