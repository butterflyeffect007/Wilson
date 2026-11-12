/** Architect-only gate for Wilson's Terminal. Localhost e2e may bypass with ?e2e_architect=1. */
export function isE2EArchitect(): boolean {
  try {
    const host = location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return false;
    return /(?:^|[?&])e2e_architect=1(?:&|$)/.test(location.search);
  } catch {
    return false;
  }
}

export function canOpenTerminal(isAdmin: boolean): boolean {
  return isAdmin || isE2EArchitect();
}

export function terminalHashOpen(): boolean {
  try {
    return location.hash.replace(/^#\/?/, "").split(/[?&]/)[0] === "terminal";
  } catch {
    return false;
  }
}

export function openTerminalHash(): void {
  try { location.hash = "#terminal"; } catch { /* ignore */ }
}

export function closeTerminalHash(): void {
  try {
    if (!terminalHashOpen()) return;
    history.replaceState({}, "", location.pathname + location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } catch { /* ignore */ }
}
