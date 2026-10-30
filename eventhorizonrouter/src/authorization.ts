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
  if (registry instanceof Map) {
    return new Map(registry);
  }

  return new Map(Object.entries(registry));
}

function getIntentExpiry(intent: TransactionIntent): number {
  if (typeof intent.expiry === 'number') {
    return intent.expiry;
  }

  if (typeof intent.expiresAt === 'number') {
    return intent.expiresAt;
  }

  return Number.MAX_SAFE_INTEGER;
}

function resolveThreshold(signatureBundles: SignatureBundle[], explicitThreshold?: number): number {
  if (typeof explicitThreshold === 'number' && explicitThreshold > 0) {
    return explicitThreshold;
  }

  if (signatureBundles.length === 0) {
    return 1;
  }

  return Math.max(1, Math.ceil((signatureBundles.length * 2) / 3));
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
      error: 'intent expired',
      valid: false,
      reason: 'intent expired',
      approvedSigners: [],
    };
  }

  if (seenNonces && seenNonces.has(intent.nonce)) {
    return {
      success: false,
      error: 'nonce replay',
      valid: false,
      reason: 'nonce replay',
      approvedSigners: [],
    };
  }

  const registry = normalizeRegistry(authorizedSigners);
  const approvedSigners: string[] = [];
  const canonical = canonicalizeIntent(intent);

  for (const bundle of signatureBundles) {
    const publicKeyHex = (bundle.signerPublicKey ?? '').trim();

    if (!publicKeyHex) {
      continue;
    }

    const signer = registry.get(publicKeyHex.toLowerCase());
    if (!signer || signer.revoked) {
      continue;
    }

    try {
      const publicKeyObject = crypto.createPublicKey({
        key: Buffer.from(publicKeyHex, 'hex'),
        format: 'der',
        type: 'spki',
      });

      const signatureBuffer = Buffer.from(bundle.signature ?? '', 'hex');
      const isValid = crypto.verify(
        null,
        Buffer.from(canonical, 'utf-8'),
        publicKeyObject,
        signatureBuffer
      );

      if (isValid) {
        approvedSigners.push(publicKeyHex.toLowerCase());
      }
    } catch {
      // ignore malformed or invalid signatures and continue verifying the remaining bundle
    }
  }

  const requiredThreshold = resolveThreshold(signatureBundles, threshold);
  const verifiedCount = approvedSigners.length;

  if (verifiedCount < requiredThreshold) {
    return {
      success: false,
      error: `threshold not met: ${verifiedCount}/${requiredThreshold}`,
      valid: false,
      reason: 'threshold not met',
      approvedSigners,
    };
  }

  return {
    success: true,
    verifiedIntent: intent,
    valid: true,
    reason: 'authorized',
    approvedSigners,
  };
}
