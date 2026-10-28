/**
 * Biometric gate: enroll → unlock → lock cycle with a mocked WebAuthn platform authenticator.
 * Run: npm run test:biometrics   (node:test via tsx, same runner as workers/federation-ingest)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BiometricGate, GateError, LocalStubProvider } from "../../src/lib/biometrics/biometric-gate.ts";
import { KeyStore, MemoryBackend, toB64url, concatBytes } from "../../src/lib/biometrics/key-store.ts";

const RP = "wilson.test";
const ORIGIN = "https://wilson.test";
const subtle = globalThis.crypto.subtle;

const u8 = (b: ArrayBuffer | ArrayBufferView) => b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const sha = async (b: Uint8Array) => new Uint8Array(await subtle.digest("SHA-256", b));
const enc = (s: string) => new TextEncoder().encode(s);

function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0; while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i); if (v[0] & 0x80) v = concatBytes(new Uint8Array([0]), v);
    return concatBytes(new Uint8Array([0x02, v.length]), v);
  };
  const body = concatBytes(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concatBytes(new Uint8Array([0x30, body.length]), body);
}

/** A fake platform authenticator that does real P-256 signing and a deterministic PRF. */
class FakeAuthenticator {
  keys?: CryptoKeyPair;
  credId = crypto.getRandomValues(new Uint8Array(16));
  prfSecret = crypto.getRandomValues(new Uint8Array(32));
  counter = 0;
  supportsPrf = true;
  userVerified = true;
  cancelNext = false;
  rollbackCounter = false;
  corruptSignature = false;
  replayLast = false;
  last: unknown = null;
  origin = ORIGIN;

  private async authData(flags: number) {
    const c = new Uint8Array(4); new DataView(c.buffer).setUint32(0, this.counter, false);
    return concatBytes(await sha(enc(RP)), new Uint8Array([flags]), c);
  }
  private clientData(type: string, challenge: BufferSource) {
    return enc(JSON.stringify({ type, challenge: toB64url(u8(challenge as ArrayBuffer)), origin: this.origin, crossOrigin: false })).buffer;
  }
  private async prf(salt: BufferSource) {
    const k = await subtle.importKey("raw", this.prfSecret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return subtle.sign("HMAC", k, concatBytes(enc("WebAuthn PRF\0"), u8(salt as ArrayBuffer)));
  }

  credentials = {
    create: async (o: CredentialCreationOptions) => {
      if (this.cancelNext) { this.cancelNext = false; throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" }); }
      const pk = o.publicKey!;
      assert.equal(pk.authenticatorSelection?.userVerification, "required");
      this.keys = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
      const spki = await subtle.exportKey("spki", this.keys.publicKey);
      const authData = await this.authData(this.userVerified ? 0x45 : 0x41);
      return {
        rawId: this.credId.buffer, type: "public-key",
        response: {
          clientDataJSON: this.clientData("webauthn.create", pk.challenge),
          getPublicKey: () => spki, getPublicKeyAlgorithm: () => -7, getAuthenticatorData: () => authData.buffer,
        },
        getClientExtensionResults: () => (this.supportsPrf ? { prf: { enabled: true } } : {}),
      } as unknown as Credential;
    },
    get: async (o: CredentialRequestOptions) => {
      if (this.cancelNext) { this.cancelNext = false; throw Object.assign(new Error("cancelled"), { name: "NotAllowedError" }); }
      if (this.replayLast && this.last) return this.last as Credential;
      const pk = o.publicKey!;
      assert.equal(pk.userVerification, "required");
      this.counter = this.rollbackCounter ? Math.max(0, this.counter - 1) : this.counter + 1;
      const authData = await this.authData(this.userVerified ? 0x05 : 0x01);
      const clientDataJSON = this.clientData("webauthn.get", pk.challenge);
      const signed = concatBytes(authData, await sha(u8(clientDataJSON)));
      const der = rawToDer(new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys!.privateKey, signed)));
      if (this.corruptSignature) der[der.length - 1] ^= 0xff;
      const salt = (pk.extensions as { prf?: { eval?: { first: BufferSource } } })?.prf?.eval?.first;
      const prfOut = this.supportsPrf && salt ? await this.prf(salt) : undefined;
      const cred = {
        rawId: this.credId.buffer, type: "public-key",
        response: { clientDataJSON, authenticatorData: authData.buffer, signature: der.buffer, userHandle: null },
        getClientExtensionResults: () => (prfOut ? { prf: { results: { first: prfOut } } } : {}),
      } as unknown as Credential;
      this.last = cred;
      return cred;
    },
  };
}

function makeGate(auth: FakeAuthenticator | null, extra: Partial<ConstructorParameters<typeof BiometricGate>[0]> = {}) {
  const backend = new MemoryBackend();
  const gate = new BiometricGate({
    store: new KeyStore(backend),
    credentials: auth?.credentials ?? null,
    platformAuthenticatorAvailable: async () => !!auth,
    rpId: RP, origin: ORIGIN, allowInsecureFallback: false, autoLockMs: 0,
    ...extra,
  });
  return { gate, backend };
}

const rejectsWith = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof GateError && e.code === code);

test("enroll → unlock → lock cycle (WebAuthn + PRF)", async () => {
  const auth = new FakeAuthenticator();
  const { gate } = makeGate(auth);
  assert.equal(await gate.init(), "not-enrolled");
  assert.equal(await gate.isEnrolled(), false);

  const { method } = await gate.enroll();
  assert.equal(method, "webauthn-prf");
  assert.equal(await gate.isEnrolled(), true);
  assert.equal(gate.getState(), "unlocked");

  await gate.sealSecret("github-cli-token", "gho_TESTTOKEN123");
  gate.lock();
  assert.equal(gate.getState(), "locked");
  assert.equal(gate.isUnlocked(), false);
  await rejectsWith(gate.openSecret("github-cli-token"), "locked");

  await gate.unlock();
  assert.equal(gate.getState(), "unlocked");
  assert.equal(await gate.openSecret("github-cli-token"), "gho_TESTTOKEN123");

  gate.lock();
  await gate.unlock(); // counter keeps moving forward
  assert.equal(gate.isUnlocked(), true);
});

test("a fresh gate instance (reload) starts locked and can unlock", async () => {
  const auth = new FakeAuthenticator();
  const backend = new MemoryBackend();
  const opts = { credentials: auth.credentials, platformAuthenticatorAvailable: async () => true, rpId: RP, origin: ORIGIN, autoLockMs: 0 };
  await new BiometricGate({ ...opts, store: new KeyStore(backend) }).enroll();
  const reloaded = new BiometricGate({ ...opts, store: new KeyStore(backend) });
  assert.equal(await reloaded.init(), "locked");
  await reloaded.unlock();
  assert.equal(reloaded.getState(), "unlocked");
});

test("nothing sensitive is stored in plaintext", async () => {
  const auth = new FakeAuthenticator();
  const { gate, backend } = makeGate(auth);
  await gate.enroll();
  await gate.sealSecret("github-cli-token", "gho_SUPERSECRET");
  const atRest = JSON.stringify(backend.dump());
  for (const needle of ["gho_SUPERSECRET", "webauthn-prf", "keyCheck", "publicKey", toB64url(auth.credId), toB64url(auth.prfSecret)]) {
    assert.ok(!atRest.includes(needle), `found ${needle} at rest`);
  }
});

test("replayed assertion is refused", async () => {
  const auth = new FakeAuthenticator();
  const { gate } = makeGate(auth);
  await gate.enroll();
  gate.lock();
  auth.replayLast = true;
  await rejectsWith(gate.unlock(), "replay");
  assert.equal(gate.isUnlocked(), false);
});

test("signature counter going backwards is refused (cloned authenticator)", async () => {
  const auth = new FakeAuthenticator();
  const { gate } = makeGate(auth);
  await gate.enroll();
  gate.lock();
  await gate.unlock();
  gate.lock();
  auth.rollbackCounter = true;
  await rejectsWith(gate.unlock(), "replay");
});

test("missing user verification, bad signature, wrong origin and a different authenticator all fail", async () => {
  const auth = new FakeAuthenticator();
  const { gate } = makeGate(auth);
  await gate.enroll();
  gate.lock();

  auth.userVerified = false;
  await rejectsWith(gate.unlock(), "verification-failed");
  auth.userVerified = true;

  auth.corruptSignature = true;
  await rejectsWith(gate.unlock(), "verification-failed");
  auth.corruptSignature = false;

  auth.origin = "https://evil.example";
  await rejectsWith(gate.unlock(), "verification-failed");
  auth.origin = ORIGIN;

  const realSecret = auth.prfSecret;
  auth.prfSecret = crypto.getRandomValues(new Uint8Array(32)); // same key pair, different biometric-bound secret
  await rejectsWith(gate.unlock(), "verification-failed");
  auth.prfSecret = realSecret;

  assert.equal(gate.isUnlocked(), false);
  await gate.unlock();
  assert.equal(gate.isUnlocked(), true);
});

test("cancelled prompt maps to 'cancelled' and leaves the gate locked", async () => {
  const auth = new FakeAuthenticator();
  const { gate } = makeGate(auth);
  await gate.enroll();
  gate.lock();
  auth.cancelNext = true;
  await rejectsWith(gate.unlock(), "cancelled");
  assert.equal(gate.getState(), "locked");
});

test("authenticator without PRF still enrolls and cycles (method 'webauthn')", async () => {
  const auth = new FakeAuthenticator();
  auth.supportsPrf = false;
  const { gate } = makeGate(auth);
  assert.equal((await gate.enroll()).method, "webauthn");
  await gate.sealSecret("x", "y");
  gate.lock();
  await gate.unlock();
  assert.equal(await gate.openSecret("x"), "y");
});

test("no WebAuthn: stub fallback only when explicitly allowed", async () => {
  const blocked = makeGate(null).gate;
  assert.equal(await blocked.init(), "unsupported");
  await rejectsWith(blocked.enroll(), "unsupported");

  const { gate } = makeGate(null, { allowInsecureFallback: true, nativeProvider: new LocalStubProvider() });
  assert.equal(await gate.init(), "not-enrolled");
  assert.equal((await gate.enroll()).method, "fallback-stub");
  gate.lock();
  await gate.unlock();
  assert.equal(gate.isUnlocked(), true);
});

test("enrolling twice is refused; unenroll wipes everything", async () => {
  const auth = new FakeAuthenticator();
  const { gate, backend } = makeGate(auth);
  await gate.enroll();
  await rejectsWith(gate.enroll(), "already-enrolled");
  await gate.unenroll();
  assert.equal(await gate.isEnrolled(), false);
  assert.deepEqual(Object.keys(backend.dump()), []);
  assert.equal(gate.getState(), "not-enrolled");
});

test("auto-lock after inactivity", async () => {
  const auth = new FakeAuthenticator();
  const { gate } = makeGate(auth, { autoLockMs: 30 });
  const states: string[] = [];
  gate.subscribe((s) => states.push(s));
  await gate.enroll();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(gate.getState(), "locked");
  assert.deepEqual(states, ["unlocked", "locked"]);
});
