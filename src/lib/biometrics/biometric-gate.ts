/**
 * Wilson biometric gate — enroll(), unlock(), isEnrolled(), lock().
 *
 * How it works (full design: artifacts/biometric-unlock-architecture.md):
 *  - Biometrics are matched by the device's platform authenticator (Face ID / Touch ID / Windows Hello /
 *    Android BiometricPrompt) through WebAuthn with userVerification: "required". The raw template never
 *    leaves the secure hardware and never reaches Wilson.
 *  - Key derivation: the WebAuthn PRF extension gives a per-credential secret that the authenticator only
 *    releases after a successful biometric match. Wilson runs it through HKDF-SHA256 to get the unlock key
 *    and stores ONLY a hash of the derived key (keyCheck) — never the key, never biometric data.
 *  - Every unlock is a fresh WebAuthn assertion over a random challenge, verified locally: origin, type,
 *    challenge, rpId hash, user-present + user-verified flags, signature (stored public key), and a
 *    monotonic signature counter (replay / clone signal).
 *  - Unlocked state lives in memory only. lock() drops the key; a reload is always locked.
 *
 * Fallbacks:
 *  - WebAuthn without PRF: assertion is still verified, but the unlock key comes from a random seed sealed
 *    under the device key (weaker at rest; documented in the threat model).
 *  - No WebAuthn at all: NativeBiometricProvider. The default is a LOCAL KEY-DERIVATION STUB.
 *    TODO(native-biometrics): replace LocalStubProvider with a Capacitor plugin
 *    (iOS LocalAuthentication + Keychain/Secure Enclave, Android BiometricPrompt + Keystore) that releases a
 *    hardware-held secret only after a biometric match. The stub performs NO user verification, so it is
 *    disabled unless `allowInsecureFallback` is set (default: dev builds only).
 */

import {
  KeyStore, randomBytes, toB64url, fromB64url, utf8, concatBytes, timingSafeEqual, type Bytes,
} from "./key-store";

export type GateState = "unsupported" | "not-enrolled" | "locked" | "unlocked";
export type GateMethod = "webauthn-prf" | "webauthn" | "fallback-stub";

export type GateErrorCode =
  | "unsupported" | "not-enrolled" | "already-enrolled" | "cancelled"
  | "verification-failed" | "replay" | "locked";

export class GateError extends Error {
  constructor(public code: GateErrorCode, message: string) { super(message); this.name = "GateError"; }
}

/** Native (non-WebAuthn) biometric hook. */
export interface NativeBiometricProvider {
  readonly name: string;
  /** True when the provider can actually verify the user biometrically. */
  readonly verifiesUser: boolean;
  isAvailable(): Promise<boolean>;
  /** Prompt for biometrics; resolve with a stable 32-byte secret released only after a match, or null on failure. */
  verifyAndGetSecret(reason: string, seed: Bytes): Promise<Bytes | null>;
}

/**
 * TODO(native-biometrics): STUB — no biometric check happens here. It "derives" the secret from the
 * stored seed only, which proves nothing about who is holding the device. Kept so the gate, UI and tests
 * have a non-WebAuthn code path to exercise until a real Capacitor plugin is wired in.
 */
export class LocalStubProvider implements NativeBiometricProvider {
  readonly name = "local-stub";
  readonly verifiesUser = false;
  async isAvailable() { return typeof globalThis.crypto?.subtle !== "undefined"; }
  async verifyAndGetSecret(_reason: string, seed: Bytes): Promise<Bytes | null> {
    // TODO(native-biometrics): call the native biometric prompt and return a hardware-held secret instead.
    const bits = await globalThis.crypto.subtle.digest("SHA-256", concatBytes(utf8("wilson-stub-v1"), seed));
    return new Uint8Array(bits);
  }
}

/** The slice of navigator.credentials the gate needs (injectable for tests). */
export interface CredentialsLike {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

export interface BiometricGateOptions {
  store?: KeyStore;
  credentials?: CredentialsLike | null;
  /** Resolves true when a user-verifying platform authenticator exists. */
  platformAuthenticatorAvailable?: () => Promise<boolean>;
  rpId?: string;
  rpName?: string;
  /** Expected origin in clientDataJSON (defaults to location.origin). */
  origin?: string;
  nativeProvider?: NativeBiometricProvider;
  /** Allow the stub fallback that does NOT verify the user. Default: dev builds only. */
  allowInsecureFallback?: boolean;
  /** Auto-lock after this much inactivity (ms). 0 disables. Default 15 minutes. */
  autoLockMs?: number;
  timeoutMs?: number;
}

interface EnrollmentRecord {
  v: 1;
  method: GateMethod;
  rpId: string;
  credentialId?: string;   // base64url
  publicKey?: string;      // base64url SPKI
  alg?: number;            // COSE alg (-7 ES256, -257 RS256)
  signCount: number;
  prfSalt: string;         // base64url, input to the PRF extension
  hkdfSalt: string;        // base64url
  seed?: string;           // base64url; only for "webauthn" (no PRF) and "fallback-stub"
  keyCheck: string;        // base64url SHA-256 of the derived key — the only key material at rest
  createdAt: number;
}

const RECORD = "enrollment";
const HKDF_INFO = "wilson/biometric-unlock/v1";

function viteDev(): boolean {
  try { return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV; } catch { return false; }
}

/* ---------- key derivation ---------- */

async function deriveKey(secret: Uint8Array, hkdfSalt: Bytes): Promise<{ key: CryptoKey; check: Bytes }> {
  const s = new Uint8Array(secret.length); s.set(secret);
  const ikm = await globalThis.crypto.subtle.importKey("raw", s, "HKDF", false, ["deriveBits"]);
  s.fill(0);
  const bits = new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: hkdfSalt, info: utf8(HKDF_INFO) }, ikm, 512));
  const encBits = bits.slice(0, 32);
  const checkBits = bits.slice(32, 64);
  bits.fill(0);
  const key = await globalThis.crypto.subtle.importKey("raw", encBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  encBits.fill(0);
  const check = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", concatBytes(utf8("wilson-keycheck-v1"), checkBits)));
  checkBits.fill(0);
  return { key, check };
}

/* ---------- WebAuthn verification helpers ---------- */

async function sha256(b: Uint8Array): Promise<Bytes> {
  const c = new Uint8Array(b.length); c.set(b);
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", c));
}

interface ClientData { type: string; challenge: string; origin: string; crossOrigin?: boolean }

function checkClientData(raw: ArrayBuffer, type: string, challenge: Bytes, origin: string): void {
  let cd: ClientData;
  try { cd = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new GateError("verification-failed", "Unreadable client data."); }
  if (cd.type !== type) throw new GateError("verification-failed", "Wrong ceremony type.");
  if (cd.challenge !== toB64url(challenge)) throw new GateError("replay", "Challenge mismatch (possible replay).");
  if (cd.origin !== origin) throw new GateError("verification-failed", `Unexpected origin ${cd.origin}.`);
  if (cd.crossOrigin) throw new GateError("verification-failed", "Cross-origin ceremony refused.");
}

async function checkAuthData(authData: Bytes, rpId: string): Promise<{ signCount: number }> {
  if (authData.length < 37) throw new GateError("verification-failed", "Authenticator data too short.");
  if (!timingSafeEqual(authData.slice(0, 32), await sha256(utf8(rpId)))) throw new GateError("verification-failed", "RP ID mismatch.");
  const flags = authData[32];
  if (!(flags & 0x01)) throw new GateError("verification-failed", "User presence not asserted.");
  if (!(flags & 0x04)) throw new GateError("verification-failed", "Biometric / user verification not performed.");
  const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);
  return { signCount };
}

/** ECDSA signatures from WebAuthn are DER; WebCrypto wants raw r||s. */
function derToRaw(der: Uint8Array, size = 32): Bytes {
  let o = 0;
  if (der[o++] !== 0x30) throw new GateError("verification-failed", "Bad signature encoding.");
  if (der[o] & 0x80) o += 1 + (der[o] & 0x7f); else o += 1;
  const readInt = () => {
    if (der[o++] !== 0x02) throw new GateError("verification-failed", "Bad signature encoding.");
    const len = der[o++];
    let v = der.slice(o, o + len); o += len;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(size); out.set(v, size - v.length); return out;
  };
  return concatBytes(readInt(), readInt());
}

async function verifySignature(alg: number, spki: Bytes, sig: Bytes, data: Bytes): Promise<boolean> {
  const subtle = globalThis.crypto.subtle;
  if (alg === -7) {
    const k = await subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, derToRaw(sig), data);
  }
  if (alg === -257) {
    const k = await subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return subtle.verify("RSASSA-PKCS1-v1_5", k, sig, data);
  }
  throw new GateError("unsupported", `Unsupported credential algorithm ${alg}.`);
}

function asBytes(b: ArrayBuffer | ArrayBufferView): Bytes {
  const v = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  const out = new Uint8Array(v.length); out.set(v); return out;
}

function isCancel(e: unknown): boolean {
  const n = (e as { name?: string })?.name;
  return n === "NotAllowedError" || n === "AbortError";
}

/* ---------- the gate ---------- */

export class BiometricGate {
  private store: KeyStore;
  private credentials: CredentialsLike | null;
  private platformAvailable: () => Promise<boolean>;
  private rpId: string;
  private rpName: string;
  private origin: string;
  private native: NativeBiometricProvider;
  private allowInsecureFallback: boolean;
  private autoLockMs: number;
  private timeoutMs: number;

  private unlockKey: CryptoKey | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private state: GateState = "locked";
  private listeners = new Set<(s: GateState) => void>();

  constructor(opts: BiometricGateOptions = {}) {
    const hasWindow = typeof window !== "undefined";
    this.store = opts.store ?? new KeyStore();
    this.credentials = opts.credentials !== undefined ? opts.credentials
      : (typeof navigator !== "undefined" && navigator.credentials && hasWindow && "PublicKeyCredential" in window ? navigator.credentials : null);
    this.platformAvailable = opts.platformAuthenticatorAvailable ?? (async () => {
      try {
        const PKC = hasWindow ? (window as unknown as { PublicKeyCredential?: typeof PublicKeyCredential }).PublicKeyCredential : undefined;
        return !!PKC && (await PKC.isUserVerifyingPlatformAuthenticatorAvailable());
      } catch { return false; }
    });
    this.rpId = opts.rpId ?? (hasWindow ? location.hostname : "localhost");
    this.rpName = opts.rpName ?? "Wilson";
    this.origin = opts.origin ?? (hasWindow ? location.origin : "http://localhost");
    this.native = opts.nativeProvider ?? new LocalStubProvider();
    this.allowInsecureFallback = opts.allowInsecureFallback ?? viteDev();
    this.autoLockMs = opts.autoLockMs ?? 15 * 60 * 1000;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /* ----- state ----- */

  getState(): GateState { return this.state; }
  isUnlocked(): boolean { return this.state === "unlocked" && !!this.unlockKey; }

  subscribe(fn: (s: GateState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private setState(s: GateState) {
    if (this.state === s) return;
    this.state = s;
    for (const fn of this.listeners) { try { fn(s); } catch { /* listener errors never break the gate */ } }
  }

  /** Work out the starting state (always locked when enrolled — unlocks never persist). */
  async init(): Promise<GateState> {
    if (await this.isEnrolled()) this.setState(this.isUnlocked() ? "unlocked" : "locked");
    else this.setState((await this.availableMethod()) ? "not-enrolled" : "unsupported");
    return this.state;
  }

  async isEnrolled(): Promise<boolean> {
    return !!(await this.store.getRecord<EnrollmentRecord>(RECORD));
  }

  /** Which method enrollment would use on this device, or null if none is allowed. */
  async availableMethod(): Promise<GateMethod | null> {
    if (this.credentials && (await this.platformAvailable())) return "webauthn-prf"; // PRF is confirmed at enroll time
    if (await this.native.isAvailable()) {
      if (this.native.verifiesUser || this.allowInsecureFallback) return "fallback-stub";
    }
    return null;
  }

  async isSupported(): Promise<boolean> { return (await this.availableMethod()) !== null; }

  /* ----- enroll ----- */

  async enroll(opts: { userName?: string; displayName?: string } = {}): Promise<{ method: GateMethod }> {
    if (await this.isEnrolled()) throw new GateError("already-enrolled", "Already enrolled on this device.");
    const method = await this.availableMethod();
    if (!method) throw new GateError("unsupported", "No biometric authenticator available on this device.");

    const prfSalt = randomBytes(32);
    const hkdfSalt = randomBytes(32);

    if (method === "fallback-stub") {
      const seed = randomBytes(32);
      const secret = await this.native.verifyAndGetSecret("Enroll Wilson", seed);
      if (!secret) throw new GateError("verification-failed", "Native biometric check failed.");
      const { key, check } = await deriveKey(secret, hkdfSalt);
      secret.fill(0);
      await this.store.putRecord(RECORD, {
        v: 1, method, rpId: this.rpId, signCount: 0, prfSalt: toB64url(prfSalt), hkdfSalt: toB64url(hkdfSalt),
        seed: toB64url(seed), keyCheck: toB64url(check), createdAt: Date.now(),
      } satisfies EnrollmentRecord);
      this.setUnlocked(key);
      return { method };
    }

    // WebAuthn registration
    const challenge = randomBytes(32);
    let cred: PublicKeyCredential;
    try {
      cred = (await this.credentials!.create({
        publicKey: {
          rp: { id: this.rpId, name: this.rpName },
          user: { id: randomBytes(16), name: opts.userName ?? "architect", displayName: opts.displayName ?? "Wilson Architect" },
          challenge,
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
          attestation: "none",
          timeout: this.timeoutMs,
          extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential;
    } catch (e) {
      if (isCancel(e)) throw new GateError("cancelled", "Enrollment was cancelled.");
      throw e;
    }
    if (!cred) throw new GateError("cancelled", "Enrollment was cancelled.");

    const resp = cred.response as AuthenticatorAttestationResponse;
    checkClientData(resp.clientDataJSON, "webauthn.create", challenge, this.origin);
    const spki = resp.getPublicKey?.();
    const alg = resp.getPublicKeyAlgorithm?.();
    if (!spki || alg === undefined) throw new GateError("unsupported", "This browser doesn't expose the credential public key.");
    const authData = resp.getAuthenticatorData ? asBytes(resp.getAuthenticatorData()) : null;
    let signCount = 0;
    if (authData) ({ signCount } = await checkAuthData(authData, this.rpId));

    const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
    const prfEnabled = !!ext.prf?.enabled || !!ext.prf?.results?.first;

    const base = {
      v: 1 as const, rpId: this.rpId, credentialId: toB64url(cred.rawId), publicKey: toB64url(spki), alg, signCount,
      prfSalt: toB64url(prfSalt), hkdfSalt: toB64url(hkdfSalt), createdAt: Date.now(),
    };

    if (prfEnabled) {
      let secret: Bytes | null = ext.prf?.results?.first ? asBytes(ext.prf.results.first) : null;
      let record: EnrollmentRecord = { ...base, method: "webauthn-prf", keyCheck: "" };
      if (!secret) {
        // Most authenticators only evaluate PRF during an assertion: run one now (second biometric prompt).
        const r = await this.assert(record);
        secret = r.prf;
        record = { ...record, signCount: r.signCount };
        if (!secret) throw new GateError("verification-failed", "Authenticator didn't return a PRF result.");
      }
      const { key, check } = await deriveKey(secret, hkdfSalt);
      secret.fill(0);
      await this.store.putRecord(RECORD, { ...record, keyCheck: toB64url(check) });
      this.setUnlocked(key);
      return { method: "webauthn-prf" };
    }

    // WebAuthn without PRF: verified assertion gates a seed held under the device key.
    const seed = randomBytes(32);
    const { key, check } = await deriveKey(seed, hkdfSalt);
    await this.store.putRecord(RECORD, { ...base, method: "webauthn", seed: toB64url(seed), keyCheck: toB64url(check) } satisfies EnrollmentRecord);
    seed.fill(0);
    this.setUnlocked(key);
    return { method: "webauthn" };
  }

  /** Run and fully verify one WebAuthn assertion against an enrollment record. */
  private async assert(rec: EnrollmentRecord): Promise<{ signCount: number; prf: Bytes | null }> {
    const challenge = randomBytes(32);
    let cred: PublicKeyCredential;
    try {
      cred = (await this.credentials!.get({
        publicKey: {
          rpId: rec.rpId,
          challenge,
          allowCredentials: [{ type: "public-key", id: fromB64url(rec.credentialId!), transports: ["internal"] }],
          userVerification: "required",
          timeout: this.timeoutMs,
          extensions: (rec.method === "webauthn-prf" ? { prf: { eval: { first: fromB64url(rec.prfSalt) } } } : {}) as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential;
    } catch (e) {
      if (isCancel(e)) throw new GateError("cancelled", "Unlock was cancelled.");
      throw e;
    }
    if (!cred) throw new GateError("cancelled", "Unlock was cancelled.");
    if (toB64url(cred.rawId) !== rec.credentialId) throw new GateError("verification-failed", "Unknown credential.");

    const resp = cred.response as AuthenticatorAssertionResponse;
    checkClientData(resp.clientDataJSON, "webauthn.get", challenge, this.origin);
    const authData = asBytes(resp.authenticatorData);
    const { signCount } = await checkAuthData(authData, rec.rpId);
    const signed = concatBytes(authData, await sha256(asBytes(resp.clientDataJSON)));
    const ok = await verifySignature(rec.alg!, fromB64url(rec.publicKey!), asBytes(resp.signature), signed);
    if (!ok) throw new GateError("verification-failed", "Signature check failed.");
    // Counter must strictly increase unless the authenticator never counts (both zero) — a drop means a cloned key or a replay.
    if ((signCount !== 0 || rec.signCount !== 0) && signCount <= rec.signCount) {
      throw new GateError("replay", "Signature counter went backwards (possible cloned authenticator or replay).");
    }
    const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
    return { signCount, prf: ext.prf?.results?.first ? asBytes(ext.prf.results.first) : null };
  }

  /* ----- unlock / lock ----- */

  async unlock(): Promise<void> {
    const rec = await this.store.getRecord<EnrollmentRecord>(RECORD);
    if (!rec) { this.setState("not-enrolled"); throw new GateError("not-enrolled", "Enroll first."); }
    if (this.isUnlocked()) { this.touch(); return; }

    let secret: Bytes | null;
    if (rec.method === "fallback-stub") {
      if (!this.native.verifiesUser && !this.allowInsecureFallback) throw new GateError("unsupported", "Insecure fallback is disabled in this build.");
      secret = await this.native.verifyAndGetSecret("Unlock Wilson", fromB64url(rec.seed!));
      if (!secret) throw new GateError("verification-failed", "Native biometric check failed.");
    } else {
      if (!this.credentials) throw new GateError("unsupported", "WebAuthn is not available here.");
      const r = await this.assert(rec);
      await this.store.putRecord(RECORD, { ...rec, signCount: r.signCount });
      secret = rec.method === "webauthn-prf" ? r.prf : fromB64url(rec.seed!);
      if (!secret) throw new GateError("verification-failed", "Authenticator didn't return a PRF result.");
    }

    const { key, check } = await deriveKey(secret, fromB64url(rec.hkdfSalt));
    secret.fill(0);
    if (!timingSafeEqual(check, fromB64url(rec.keyCheck))) throw new GateError("verification-failed", "Derived key didn't match enrollment.");
    this.setUnlocked(key);
  }

  lock(): void {
    this.unlockKey = null;
    if (this.lockTimer) { clearTimeout(this.lockTimer); this.lockTimer = null; }
    if (this.state === "unlocked") this.setState("locked");
  }

  /** Extend the auto-lock window (call on user activity). */
  touch(): void {
    if (!this.isUnlocked() || !this.autoLockMs) return;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => this.lock(), this.autoLockMs);
  }

  private setUnlocked(key: CryptoKey) {
    this.unlockKey = key;
    this.setState("unlocked");
    this.touch();
  }

  /* ----- sealed secrets (e.g. the GitHub CLI token) ----- */

  async sealSecret(name: string, value: string): Promise<void> {
    if (!this.isUnlocked()) throw new GateError("locked", "Unlock Wilson first.");
    await this.store.putSecret(name, value, this.unlockKey!);
    this.touch();
  }

  async openSecret(name: string): Promise<string | null> {
    if (!this.isUnlocked()) throw new GateError("locked", "Unlock Wilson first.");
    this.touch();
    return this.store.getSecret(name, this.unlockKey!);
  }

  /** Remove enrollment and every sealed secret. Requires an unlocked gate (device-loss recovery = clear site data). */
  async unenroll(): Promise<void> {
    if (!this.isUnlocked()) throw new GateError("locked", "Unlock before removing enrollment.");
    this.lock();
    await this.store.wipe();
    this.setState((await this.availableMethod()) ? "not-enrolled" : "unsupported");
  }
}
