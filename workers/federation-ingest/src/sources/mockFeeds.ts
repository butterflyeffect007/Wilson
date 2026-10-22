export interface NormalizedEnvelope {
  schema_version: "1.0";
  record_id: string;
  subject: { type: string; id: string };
  measurement: { name: string; value: number; unit: string };
  observed_at: string;
  source: { source_id: string; source_record_id: string };
}

export function createMockFeed(
  sourceId: "mock-feed-alpha" | "mock-feed-beta",
  value: number,
): () => Promise<NormalizedEnvelope> {
  return async () => ({
    schema_version: "1.0",
    record_id: `water-ph-${sourceId === "mock-feed-alpha" ? "alpha" : "beta"}-001`,
    subject: { type: "water_sample", id: "sample-austin-001" },
    measurement: { name: "ph", value, unit: "pH" },
    observed_at: "2026-10-19T12:00:00.000Z",
    source: {
      source_id: sourceId,
      source_record_id: sourceId === "mock-feed-alpha" ? "alpha-001" : "beta-001",
    },
  });
}

export function validateEnvelope(value: unknown): value is NormalizedEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NormalizedEnvelope>;
  return item.schema_version === "1.0"
    && typeof item.record_id === "string" && item.record_id.length > 0
    && !!item.subject && typeof item.subject.type === "string"
    && typeof item.subject.id === "string" && item.subject.id.length > 0
    && !!item.measurement && typeof item.measurement.name === "string"
    && typeof item.measurement.value === "number" && Number.isFinite(item.measurement.value)
    && typeof item.measurement.unit === "string"
    && typeof item.observed_at === "string" && !Number.isNaN(Date.parse(item.observed_at))
    && !!item.source && typeof item.source.source_id === "string"
    && typeof item.source.source_record_id === "string";
}
