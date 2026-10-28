/**
 * Wilson biometric key store — encrypted local storage for the biometric gate.
 *
 * Rules this file enforces:
 *  - Nothing is written in plaintext. Every record is AES-GCM (256-bit) sealed.
 *  - The device wrapping key is a NON-EXTRACTABLE WebCrypto key. Its raw bytes never exist in JS;
 *    IndexedDB stores the CryptoKey handle itself (structured clone), so it can't be copied out as text.
 *  - Secrets (e.g. a GitHub token) are sealed twice: inner layer under the biometric-derived unlock key,
 *    outer layer under the device key. Without a successful biometric unlock the inner layer can't be opened.
 *  - No raw biometric data ever reaches this file. The gate only hands it derived keys / key hashes.
 *
 * Storage backend is pluggable so tests can run in Node with an in-memory backend.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

/* ---------- byte helpers ---------- */

export function randomBytes(n: number): Bytes {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(s: string): Bytes {
  const e = new TextEncoder().encode(s);
  const out = new Uint8Array(e.length);
  out.set(e);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Constant-time equality for short byte strings (key hashes). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/* ---------- AES-GCM sealing ---------- */

export interface SealedBlob {
  v: 1;
  alg: "A256GCM";
  iv: string; // base64url, 12 bytes, fresh per seal
  ct: string; // base64url ciphertext + 128-bit tag
}

export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<SealedBlob> {
  const iv = randomBytes(12);
  const pt = new Uint8Array(plaintext.length); pt.set(plaintext);
  const ct = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad), tagLength: 128 }, key, pt);
  pt.fill(0);
  return { v: 1, alg: "A256GCM", iv: toB64url(iv), ct: toB64url(ct) };
}

export async function unseal(key: CryptoKey, blob: SealedBlob, aad: string): Promise<Bytes> {
  if (!blob || blob.v !== 1 || blob.alg !== "A256GCM") throw new Error("key-store: unknown blob format");
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(blob.iv), additionalData: utf8(aad), tagLength: 128 }, key, fromB64url(blob.ct));
  return new Uint8Array(pt);
}

/* ---------- storage backends ---------- */

export interface KeyStoreBackend {
  get(name: string): Promise<unknown>;
  put(name: string, value: unknown): Promise<void>;
  delete(name: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory backend (tests, or browsers without IndexedDB — nothing survives a reload). */
export class MemoryBackend implements KeyStoreBackend {
  private m = new Map<string, unknown>();
  async get(name: string) { return this.m.get(name); }
  async put(name: string, value: unknown) { this.m.set(name, value); }
  async delete(name: string) { this.m.delete(name); }
  async clear() { this.m.clear(); }
  /** Test helper: raw view of what is at rest. */
  dump(): Record<string, unknown> { return Object.fromEntries(this.m); }
}

/** IndexedDB backend. Stores CryptoKey handles natively so the device key stays non-extractable. */
export class IndexedDBBackend implements KeyStoreBackend {
  private dbp: Promise<IDBDatabase> | null = null;
  constructor(private dbName = "wilson-biometrics", private storeName = "kv") {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(this.storeName)) req.result.createObjectStore(this.storeName); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(this.storeName, mode);
      const r = fn(t.objectStore(this.storeName));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    });
  }

  get(name: string) { return this.tx<unknown>("readonly", (s) => s.get(name)); }
  async put(name: string, value: unknown) { await this.tx("readwrite", (s) => s.put(value, name)); }
  async delete(name: string) { await this.tx("readwrite", (s) => s.delete(name)); }
  async clear() { await this.tx("readwrite", (s) => s.clear()); }
}

export function defaultBackend(): KeyStoreBackend {
  if (typeof indexedDB !== "undefined") return new IndexedDBBackend();
  return new MemoryBackend();
}

/* ---------- the key store ---------- */

const DEVICE_KEY = "device-key";
const REC = "rec:";
const SECRET = "secret:";

export class KeyStore {
  private deviceKeyP: Promise<CryptoKey> | null = null;
  constructor(private backend: KeyStoreBackend = defaultBackend()) {}

  /** Get or create the non-extractable AES-GCM device wrapping key. */
  private deviceKey(): Promise<CryptoKey> {
    if (!this.deviceKeyP) {
      this.deviceKeyP = (async () => {
        const existing = await this.backend.get(DEVICE_KEY);
        if (existing && typeof existing === "object" && (existing as CryptoKey).type === "secret") return existing as CryptoKey;
        const key = await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await this.backend.put(DEVICE_KEY, key);
        return key;
      })();
      this.deviceKeyP.catch(() => { this.deviceKeyP = null; });
    }
    return this.deviceKeyP;
  }

  /** Store a JSON-serialisable record, sealed under the device key (AAD binds it to its name). */
  async putRecord(name: string, value: unknown): Promise<void> {
    const blob = await seal(await this.deviceKey(), utf8(JSON.stringify(value)), REC + name);
    await this.backend.put(REC + name, blob);
  }

  async getRecord<T>(name: string): Promise<T | null> {
    const blob = (await this.backend.get(REC + name)) as SealedBlob | undefined;
    if (!blob) return null;
    const pt = await unseal(await this.deviceKey(), blob, REC + name);
    try { return JSON.parse(new TextDecoder().decode(pt)) as T; } finally { pt.fill(0); }
  }

  async deleteRecord(name: string): Promise<void> { await this.backend.delete(REC + name); }

  /** Seal a secret under the biometric unlock key, then wrap it under the device key. */
  async putSecret(name: string, value: string, unlockKey: CryptoKey): Promise<void> {
    const pt = utf8(value);
    const inner = await seal(unlockKey, pt, SECRET + name);
    pt.fill(0);
    const outer = await seal(await this.deviceKey(), utf8(JSON.stringify(inner)), SECRET + name + ":outer");
    await this.backend.put(SECRET + name, outer);
  }

  async getSecret(name: string, unlockKey: CryptoKey): Promise<string | null> {
    const outer = (await this.backend.get(SECRET + name)) as SealedBlob | undefined;
    if (!outer) return null;
    const innerBytes = await unseal(await this.deviceKey(), outer, SECRET + name + ":outer");
    const inner = JSON.parse(new TextDecoder().decode(innerBytes)) as SealedBlob;
    const pt = await unseal(unlockKey, inner, SECRET + name);
    try { return new TextDecoder().decode(pt); } finally { pt.fill(0); }
  }

  async deleteSecret(name: string): Promise<void> { await this.backend.delete(SECRET + name); }

  /** Forget everything, including the device key (device-loss / re-enroll path). */
  async wipe(): Promise<void> {
    await this.backend.clear();
    this.deviceKeyP = null;
  }
}
