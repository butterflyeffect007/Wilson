import test from "node:test";
import assert from "node:assert/strict";
import { hasServerVerifiedAdmin, ADMIN_VERIFY_MAX_AGE_MS } from "../../src/lib/adminAccess.ts";

function store(map: Record<string, string>) {
  return { getItem: (k: string) => (k in map ? map[k] : null) };
}

test("a spoofed flag without a key is not admin", () => {
  assert.equal(hasServerVerifiedAdmin(store({ wilson_is_admin: "1" })), false);
});

test("a prior successful server check still counts", () => {
  assert.equal(hasServerVerifiedAdmin(store({
    wilson_is_admin: "1",
    wilson_architect_key: "secret",
    wilson_admin_verified_at: String(Date.now() - 60_000),
  })), true);
});

test("an expired server check does not count", () => {
  assert.equal(hasServerVerifiedAdmin(store({
    wilson_is_admin: "1",
    wilson_architect_key: "secret",
    wilson_admin_verified_at: String(Date.now() - ADMIN_VERIFY_MAX_AGE_MS - 1000),
  })), false);
});
