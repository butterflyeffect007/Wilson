import { cachedIsAdmin, storedAdminKey } from "../lib/admin";
import { isE2EArchitect } from "./access";

const WILSON_PROXY_URL: string =
  ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) ||
  "https://wilson-proxy.butterflyeffect007.workers.dev";

const STORE = "wilson_selffix_state";

export type DiffLine = { kind: "ctx" | "del" | "add" | "file"; text: string };
export type SelfFixFile = {
  path: string;
  status: "edited" | "added" | "deleted";
  /** Full new file contents (what actually gets committed). */
  content?: string;
  /** The GitHub blob sha Wilson read, so a stale proposal is refused instead of overwriting newer code. */
  baseSha?: string | null;
};
export type SelfFixView = "propose" | "review" | "live";
export type SelfFixProposal = {
  id?: string;
  title: string;
  summary: string;
  changelogTitle?: string;
  changelogBody?: string;
  files: SelfFixFile[];
  diff: DiffLine[];
  previewUrl?: string;
  prNumber?: number;
  prUrl?: string;
  status?: "draft" | "review" | "live" | "declined" | "undone";
  createdAt?: string;
  liveAt?: string;
  mergeSha?: string;
  undoPrNumber?: number;
  undoneAt?: string;
  error?: string;
  /** What Jenny asked for, kept so a retry can reuse it. */
  request?: string;
};

export type PushLiveStatus = SelfFixProposal & {
  pr?: { state: string; url: string; mergeable?: boolean | null } | null;
  check?: { state: "waiting" | "running" | "passed" | "failed"; run?: { url?: string } | null };
  publish?: { state: "waiting" | "building" | "publishing" | "live" | "failed" | "superseded" };
};

export function canUseSelfFix(): boolean {
  return cachedIsAdmin() || isE2EArchitect();
}

export const FIXTURE: SelfFixProposal = {
  id: "e2e-observatory-back",
  title: "Observatory back button",
  summary: "Replaces the tiny × with a Back button and a 44px tap target, so it always returns you to Wilson.",
  changelogTitle: "Observatory back button",
  changelogBody: "Replaced the tiny × with a Back button and a 44px tap target, so it always returns you to Wilson.",
  files: [
    { path: "src/components/GematriaObservatory.tsx", status: "edited" },
    { path: "src/components/GematriaObservatory.css", status: "edited" },
  ],
  diff: [
    { kind: "file", text: "GematriaObservatory.tsx" },
    { kind: "ctx", text: "  <header className=\"obs-header\">" },
    { kind: "del", text: "    <button className=\"obs-close\"" },
    { kind: "del", text: "      aria-label=\"Close Observatory\">×</button>" },
    { kind: "add", text: "    <button className=\"obs-back\"" },
    { kind: "add", text: "      aria-label=\"Back to Wilson\">‹ Wilson</button>" },
    { kind: "ctx", text: "  </header>" },
    { kind: "file", text: "GematriaObservatory.css" },
    { kind: "del", text: ".obs-close { right: 3cqw; opacity: .38; }" },
    { kind: "add", text: ".obs-back { left: 3cqw; min-width: 44px;" },
    { kind: "add", text: "  min-height: 44px; opacity: 1; }" },
  ],
  previewUrl: "https://butterflyeffect007.github.io/Wilson/preview/pr-42/",
  prNumber: 42,
  status: "draft",
  liveAt: "2026-11-12T18:40:00.000Z",
};

export function proposeCardDiff(p: SelfFixProposal): DiffLine[] {
  // Compact card: one file's first hunk, matching the mockup's short preview.
  const short: DiffLine[] = [
    { kind: "ctx", text: "  <header className=\"obs-header\">" },
    { kind: "del", text: "    <button className=\"obs-close\">×</button>" },
    { kind: "add", text: "    <button className=\"obs-back\">‹ Wilson</button>" },
    { kind: "ctx", text: "  </header>" },
  ];
  if (p.id === FIXTURE.id) return short;
  const noFiles = p.diff.filter((d) => d.kind !== "file");
  return noFiles.slice(0, 8);
}

export function formatLiveWhen(iso?: string): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${get("month")} ${get("day")}, ${get("year")} · ${get("hour")}:${get("minute")} ${get("dayPeriod")} Central`;
  } catch {
    return "Central";
  }
}

export function loadSelfFix(): SelfFixProposal | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as SelfFixProposal) : null;
  } catch {
    return null;
  }
}

export function saveSelfFix(p: SelfFixProposal | null): void {
  try {
    if (!p) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, JSON.stringify(p));
  } catch { /* ignore */ }
}

export async function selffixApi(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${WILSON_PROXY_URL}/admin/selffix${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedAdminKey()}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Self-fix request failed.");
  return data;
}

export async function submitForReview(p: SelfFixProposal): Promise<SelfFixProposal> {
  if (p.files.some((f) => f.status !== "deleted" && typeof f.content !== "string")) {
    throw new Error("This proposal is missing the new file contents. Ask Wilson to make it again.");
  }
  const data = await selffixApi("/propose", {
    method: "POST",
    body: JSON.stringify({
      title: p.title,
      summary: p.summary,
      changelogTitle: p.changelogTitle || p.title,
      changelogBody: p.changelogBody || p.summary,
      files: p.files.map((f) => ({ path: f.path, status: f.status, content: f.content, baseSha: f.baseSha ?? undefined })),
      diff: p.diff,
    }),
  }) as SelfFixProposal;
  // Keep our local copy of the file contents (the worker doesn't echo them back).
  return { ...p, ...data, files: p.files, status: "review" };
}

export async function approveSelfFix(p: SelfFixProposal): Promise<SelfFixProposal> {
  const data = await selffixApi(`/${encodeURIComponent(p.id || "")}/approve`, { method: "POST" }) as SelfFixProposal;
  return { ...p, ...data, status: "live", liveAt: data.liveAt || new Date().toISOString() };
}

export async function declineSelfFix(p: SelfFixProposal): Promise<void> {
  await selffixApi(`/${encodeURIComponent(p.id || "")}/decline`, { method: "POST" });
}

export async function undoSelfFix(p: SelfFixProposal): Promise<SelfFixProposal> {
  const data = await selffixApi(`/${encodeURIComponent(p.id || "")}/undo`, { method: "POST" }) as SelfFixProposal;
  return { ...p, ...data, status: "undone" };
}

/* ---------- Reading Wilson's own code (via the worker; the GitHub token never reaches this app) ---------- */

export async function fetchSourceTree(): Promise<{ path: string; size: number }[]> {
  const data = await selffixApi("/tree") as { paths?: { path: string; size: number }[] };
  return Array.isArray(data.paths) ? data.paths : [];
}

export async function fetchSourceFile(path: string): Promise<{ path: string; content: string; sha: string | null; exists: boolean }> {
  const data = await selffixApi(`/file?path=${encodeURIComponent(path)}`) as { path: string; content?: string; sha?: string | null; exists?: boolean };
  return { path: data.path || path, content: data.content || "", sha: data.sha ?? null, exists: data.exists !== false };
}

export async function fetchPushes(): Promise<SelfFixProposal[]> {
  const data = await selffixApi("/list") as { pushes?: SelfFixProposal[] };
  return Array.isArray(data.pushes) ? data.pushes : [];
}

export async function fetchPushStatus(id: string): Promise<PushLiveStatus> {
  return await selffixApi(`/${encodeURIComponent(id)}/status`) as PushLiveStatus;
}
