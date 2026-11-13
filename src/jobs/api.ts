import { WILSON_PROXY_URL } from "../App";
import { storedAdminKey } from "../lib/admin";
import type { HuntResult, JobCard } from "./types";

async function jobsApi(path: string, init: RequestInit = {}): Promise<HuntResult & { draft?: string; draftedAt?: string }> {
  const res = await fetch(`${WILSON_PROXY_URL}/admin/jobs${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedAdminKey()}`,
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return data as HuntResult & { draft?: string; draftedAt?: string };
}

export async function runMoneyHunt(): Promise<HuntResult> {
  return jobsApi("/hunt", { method: "POST" });
}

export async function draftForCard(card: JobCard): Promise<{ draft?: string; draftedAt?: string; error?: string; needsModel?: boolean }> {
  return jobsApi("/draft", { method: "POST", body: JSON.stringify({ card }) });
}
