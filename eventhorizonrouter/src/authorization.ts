import crypto from 'node:crypto';
import { canonicalizeIntent } from './canonical.js';
import type { AuthorizedSignerRegistry, SignatureBundle, SignerRecord, TransactionIntent, VerificationResult } from './types.js';

type ValidatedSigner = { record: SignerRecord; key: crypto.KeyObject };
const failure = (reason: string, approvedSigners: string[] = []): VerificationResult => ({
  success: false, valid: false, error: reason, reason, approvedSigners,
});

function parseEd25519PublicKey(hex: string): crypto.KeyObject {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new TypeError('malformed public key encoding');
  const der = Buffer.from(hex, 'hex');
  if (der.toString('hex') !== hex.toLowerCase()) throw new TypeError('non-canonical public key encoding');
  const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('public key is not Ed25519');
  return key;
}

function validateRegistry(input: AuthorizedSignerRegistry): Map<string, ValidatedSigner> {
  if (!(input instanceof Map) && (!input || typeof input !== 'object' ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null))) {
    throw new TypeError('invalid signer registry');
  }
  const entries: [string, SignerRecord][] = input instanceof Map ? Array.from(input.entries()) : Object.entries(input);
  if (entries.length === 0) throw new TypeError('empty signer registry');
  const validated = new Map<string, ValidatedSigner>();
  for (const [registryId, candidate] of entries) {
    if (typeof registryId !== 'string') throw new TypeError('invalid registry identity');
    const id = registryId.toLowerCase();
    if (validated.has(id)) throw new TypeError('duplicate registry identity');
    if (!candidate || typeof candidate !== 'object' ||
        (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null)) {
      throw new TypeError('invalid registry entry');
    }
    if (typeof candidate.publicKey !== 'string' || candidate.publicKey.toLowerCase() !== id ||
        typeof candidate.revoked !== 'boolean' || !Number.isSafeInteger(candidate.weight) || candidate.weight < 1) {
      throw new TypeError('invalid registry entry');
    }
    validated.set(id, { record: candidate, key: parseEd25519PublicKey(id) });
  }
  return validated;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Pure deterministic Ed25519 verification. nowMs is explicit; nonce consumption belongs to execution. */
export function authorizeIntent(
  intent: TransactionIntent,
  signatureBundles: SignatureBundle[],
  authorizedSigners: AuthorizedSignerRegistry,
  threshold: number,
  nowMs: number,
): VerificationResult {
  const approvedSigners: string[] = [];
  try {
    const canonical = canonicalizeIntent(intent);
    const snapshot = JSON.parse(canonical) as TransactionIntent;
    if (!Number.isSafeInteger(snapshot.nonce) || snapshot.nonce < 0) return failure('malformed intent');
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return failure('malformed verification time');

    const hasExpiry = Object.prototype.hasOwnProperty.call(snapshot, 'expiry');
    const hasExpiresAt = Object.prototype.hasOwnProperty.call(snapshot, 'expiresAt');
    if (hasExpiry === hasExpiresAt) return failure('malformed intent expiration');
    const expiry = hasExpiry ? snapshot.expiry : snapshot.expiresAt;
    if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry) || expiry <= 0) {
      return failure('malformed intent expiration');
    }
    if (nowMs >= expiry) return failure('intent expired');
    if (!Array.isArray(signatureBundles)) return failure('malformed signature bundles');

    const registry = validateRegistry(authorizedSigners);
    const activeSignerCount = Array.from(registry.values()).filter((entry) => !entry.record.revoked).length;
    if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > activeSignerCount) {
      return failure('invalid threshold');
    }

    const message = Buffer.from(canonical, 'utf8');
    const seen = new Set<string>();
    let sawUnknownOrRevoked = false;
    for (const bundle of signatureBundles) {
      if (!bundle || typeof bundle !== 'object' || typeof bundle.signerPublicKey !== 'string' ||
          typeof bundle.signature !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(bundle.signature)) {
        return failure('malformed signature bundle', approvedSigners);
      }
      const signerId = bundle.signerPublicKey.toLowerCase();
      const submittedKey = parseEd25519PublicKey(bundle.signerPublicKey);
      if (seen.has(signerId)) return failure('duplicate signer submission', approvedSigners);
      seen.add(signerId);
      const registered = registry.get(signerId);
      if (!registered || registered.record.revoked) {
        sawUnknownOrRevoked = true;
        continue;
      }
      if (submittedKey.export({ format: 'der', type: 'spki' }).toString('hex') !== signerId) {
        return failure('malformed signer identity', approvedSigners);
      }
      const signature = Buffer.from(bundle.signature, 'hex');
      if (signature.length !== 64 || !crypto.verify(null, message, registered.key, signature)) {
        return failure('invalid signature', approvedSigners);
      }
      approvedSigners.push(signerId);
    }
    if (approvedSigners.length < threshold) {
      return failure(sawUnknownOrRevoked ? 'unknown or revoked signer' : 'threshold not met', approvedSigners);
    }
    return {
      success: true, valid: true, reason: 'authorized',
      verifiedIntent: deepFreeze(snapshot), approvedSigners: [...approvedSigners],
    };
  } catch {
    return failure('invalid authorization input', approvedSigners);
  }
}
