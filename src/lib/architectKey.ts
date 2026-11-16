/** Dependency-free read of the Architect key flags (same localStorage keys as lib/admin.ts), safe to import anywhere. */
export const architectKey = (): string => { try { return localStorage.getItem("wilson_architect_key") || ""; } catch { return ""; } };
export const isArchitectCached = (): boolean => { try { return localStorage.getItem("wilson_is_admin") === "1" && !!architectKey(); } catch { return false; } };
