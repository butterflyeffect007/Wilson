import type { NormalizedEnvelope } from "./sources/mockFeeds.ts";
import { validateEnvelope } from "./sources/mockFeeds.ts";

export interface ReconciliationGroup {
  key: string;
  status: "consistent" | "conflict";
  observations: NormalizedEnvelope[];
  distinctValues: number[];
}

export function reconcileObservations(input: readonly unknown[]): ReconciliationGroup[] {
  const groups = new Map<string, NormalizedEnvelope[]>();
  for (const candidate of input) {
    if (!validateEnvelope(candidate)) {
      throw new TypeError("Invalid normalized source envelope");
    }
    const item = candidate;
    const key = [
      item.subject.type,
      item.subject.id,
      item.measurement.name,
      item.measurement.unit,
      new Date(item.observed_at).toISOString(),
    ].join("|");
    const observations = groups.get(key) ?? [];
    observations.push(structuredClone(item));
    groups.set(key, observations);
  }

  return [...groups.entries()].map(([key, observations]) => {
    const distinctValues = [...new Set(observations.map((item) => item.measurement.value))];
    return {
      key,
      status: distinctValues.length > 1 ? "conflict" : "consistent",
      observations,
      distinctValues,
    };
  });
}

export async function provenanceHash(value: unknown): Promise<string> {
  const canonical = canonicalize(value);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}
