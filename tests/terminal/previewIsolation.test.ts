import test from "node:test";
import assert from "node:assert/strict";
import { installPreviewStorage } from "../../src/lib/previewIsolation.ts";

class FakeStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  clear() { this.m.clear(); }
  get length() { return this.m.size; }
}

test("a preview reads a copy of live storage and never writes live keys", () => {
  const proto = FakeStorage.prototype as unknown as Storage;
  const live = new FakeStorage() as unknown as Storage & FakeStorage;
  live.setItem("wilson_theme", "dark");
  live.setItem("wilson_architect_key", "k");
  live.setItem("big", "x".repeat(60_000));
  installPreviewStorage("pr-9", live, proto);
  assert.equal(live.getItem("wilson_theme"), "dark", "seeded copy is readable");
  assert.equal(live.getItem("big"), null, "large blobs are not copied");
  live.setItem("wilson_theme", "light");
  live.removeItem("wilson_architect_key");
  live.clear();
  const raw = (live as unknown as FakeStorage).m;
  assert.equal(raw.get("wilson_theme"), "dark", "live value untouched");
  assert.equal(raw.get("wilson_architect_key"), "k", "live key untouched");
  assert.ok(raw.has("big"));
  assert.equal(live.length, 0, "preview sees only its own keys after clear");
  live.setItem("a", "1");
  assert.equal(live.key(0), "a");
  assert.equal(raw.get("wilson_preview_pr-9:a"), "1");
});
