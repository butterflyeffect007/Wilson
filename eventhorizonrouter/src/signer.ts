import crypto from 'crypto';
import { TransactionIntent, SignerRecord, SignatureBundle } from './types.js';
import { canonicalizeIntent } from './canonical.js';

export function verifyIntentSignature(
  intent: TransactionIntent,
  signatureBundle: SignatureBundle,
  registeredSigners: Map<string, SignerRecord>
): boolean {
  if (Date.now() > intent.expiresAt) {
    return false;
  }

  const signer = registeredSigners.get(signatureBundle.signerPublicKey);
  if (!signer || signer.revoked) {
    return false;
  }

  const canonicalMessage = canonicalizeIntent(intent);
  const messageBuffer = Buffer.from(canonicalMessage, 'utf-8');
  const signatureBuffer = Buffer.from(signatureBundle.signature, 'hex');

  try {
    const publicKeyObject = crypto.createPublicKey({
      key: Buffer.from(signatureBundle.signerPublicKey, 'hex'),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, messageBuffer, publicKeyObject, signatureBuffer);
  } catch {
    return false;
  }
}
