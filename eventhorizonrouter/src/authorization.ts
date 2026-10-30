import crypto from 'node:crypto';
import { canonicalizeIntent } from './canonical.js';
import type {
  AuthorizedSignerRegistry,
  SignatureBundle,
  SignerRecord,
  TransactionIntent,
  VerificationResult,
} from './types.js';

function normalizeRegistry(registry: AuthorizedSignerRegistry): Map<string, SignerRecord> {
  const source = registry instanceof Map ? registry : new Map(Object.entries(registry));
  const normalized = new Map<string, SignerRecord>();

  for (const [key, value] of source) {
    normalized.set(key.toLowerCase(), value);
  }

  return normalized;
}

function getIntentExpiry(intent: TransactionIntent): number {
  if (typeof intent.expiry === 'number') return intent.expiry;
  if (typeof intent.expiresAt === 'number') return intent.expiresAt;
  return Number.MAX_SAFE_INTEGER;
}

function resolveThreshold(signatureCount: number, explicit?: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit;
  return Math.max(1, Math.ceil((signatureCount * 2) / 3));
}

export function authorizeIntent(
  intent: TransactionIntent,
  signatureBundles: SignatureBundle[],
  authorizedSigners: AuthorizedSignerRegistry,
  threshold?: number,
  seenNonces?: Set<number>
): VerificationResult {
  const now = Date.now();
  const expiry = getIntentExpiry(intent);

  if (Number.isFinite(expiry) && now >= expiry) {
    return {
      success: false,
      valid: false,
      error: 'intent expired',
      reason: 'intent expired',
      approvedSigners: [],
    };
  }

  if (seenNonces?.has(intent.nonce)) {
    return {
      success: false,
      valid: false,
      error: 'nonce replay',
      reason: 'nonce replay',
      approvedSigners: [],
    };
  }

  const registry = normalizeRegistry(authorizedSigners);
  const approvedSigners: string[] = [];
  const canonical = canonicalizeIntent(intent);
  const message = Buffer.from(canonical, 'utf-8');

  let sawUnknownOrRevoked = false;

  for (const bundle of signatureBundles) {
    const publicKeyHex = (bundle.signerPublicKey ?? '').trim().toLowerCase();
    if (!publicKeyHex) continue;

    const signer = registry.get(publicKeyHex);
    if (!signer || signer.revoked) {
      sawUnknownOrRevoked = true;
      continue;
    }

    try {
      const publicKeyObject = crypto.createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        format: 'der',
        type: 'spki',
      });

      const signatureBuffer = Buffer.from(bundle.signature ?? '', 'hex');
      const isValid = crypto.verify(null, message, publicKeyObject, signatureBuffer);

      if (isValid) {
        approvedSigners.push(publicKeyHex);
      }
    } catch {
      // malformed key or signature — ignore and continue
    }
  }

  const required = resolveThreshold(signatureBundles.length, threshold);

  if (approvedSigners.length < required) {
    const reason =
      sawUnknownOrRevoked && approvedSigners.length === 0
        ? 'unknown or revoked signer'
        : 'threshold not met';

    return {
      success: false,
      valid: false,
      error: reason,
      reason,
      approvedSigners,
    };
  }

  return {
    success: true,
    valid: true,
    reason: 'authorized',
    verifiedIntent: intent,
    approvedSigners,
  };
}
