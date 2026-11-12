import { cachedIsAdmin, storedAdminKey } from "../lib/admin";
import { isE2EArchitect } from "./access";

const WILSON_PROXY_URL: string =
  ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) ||
  "https://wilson-proxy.butterflyeffect007.workers.dev";

const STORE = "wilson_selffix_state";

export type DiffLine = { kind: "ctx" | "del" | "add" | "file"; text: string };
export type SelfFixFile = { path: string; status: "edited" | "added" | "deleted" };
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
  status?: "draft" | "review" | "live" | "declined" | "undone";
  liveAt?: string;
  error?: string;
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

async function selffixApi(path: string, init: RequestInit = {}): Promise<unknown> {
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
  const data = await selffixApi("/propose", {
    method: "POST",
    body: JSON.stringify({
      title: p.title,
      summary: p.summary,
      changelogTitle: p.changelogTitle || p.title,
      changelogBody: p.changelogBody || p.summary,
      files: p.files,
      diff: p.diff,
    }),
  }) as SelfFixProposal;
  return { ...p, ...data, status: "review" };
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
