import type { TransactionIntent, SignerRecord, SignatureBundle } from './types.js';
import { authorizeIntent } from './authorization.js';

export function verifyIntentSignature(
  intent: TransactionIntent,
  signatureBundle: SignatureBundle,
  registeredSigners: Map<string, SignerRecord>,
  nowMs: number,
): boolean {
  return authorizeIntent(intent, [signatureBundle], registeredSigners, 1, nowMs).success;
}
