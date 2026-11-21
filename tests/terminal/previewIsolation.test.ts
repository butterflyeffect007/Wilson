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
  assert.equal(live.getItem("wilson_architect_key"), null, "Architect key is not copied into the preview");
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

test("a preview never receives sign-ins, and old seeded copies are removed", () => {
  const fresh = () => class {
    m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    key(i: number) { return [...this.m.keys()][i] ?? null; }
    clear() { this.m.clear(); }
    get length() { return this.m.size; }
  };
  const S2 = fresh();
  const proto = S2.prototype as unknown as Storage;
  const live = new S2() as unknown as Storage & FakeStorage;
  const raw = (live as unknown as FakeStorage).m;
  for (const [k, v] of [["wilson_acct_token", "wsess_live"], ["wilson_acct_user", "{}"], ["wilson_is_admin", "1"], ["wilson_github_token", "g"], ["wilson_push_id", "p"], ["wilson-voice-lock", "edge-andrew"]]) raw.set(k, v);
  // an older preview build already copied everything, including the session token
  raw.set("wilson_preview_pr-7:__seeded", "1");
  raw.set("wilson_preview_pr-7:wilson_acct_token", "wsess_live");
  raw.set("wilson_preview_pr-7:wilson_architect_key", "k");
  raw.set("wilson_preview_pr-7:wilson_theme", "dark");
  installPreviewStorage("pr-7", live, proto);
  assert.equal(live.getItem("wilson_acct_token"), null);
  assert.equal(live.getItem("wilson_architect_key"), null);
  assert.equal(live.getItem("wilson_theme"), "dark", "harmless settings survive");
  assert.equal(raw.get("wilson_acct_token"), "wsess_live", "live sign-in untouched");
  assert.equal(raw.get("wilson_preview_pr-7:__seeded"), "2");

  const S3 = fresh();
  const proto3 = S3.prototype as unknown as Storage;
  const live3 = new S3() as unknown as Storage & FakeStorage;
  const raw3 = (live3 as unknown as FakeStorage).m;
  for (const [k, v] of raw) if (!k.startsWith("wilson_preview_")) raw3.set(k, v);
  installPreviewStorage("pr-8", live3, proto3);
  for (const k of ["wilson_acct_token", "wilson_acct_user", "wilson_is_admin", "wilson_github_token", "wilson_push_id"]) assert.equal(live3.getItem(k), null, k);
  assert.equal(live3.getItem("wilson-voice-lock"), "edge-andrew", "voice choice still copies");
});
