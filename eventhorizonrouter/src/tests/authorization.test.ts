import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

await ensureDir('eventhorizonrouter/src/tests');

const out = createWriteStream('eventhorizonrouter/src/tests/authorization.test.ts');
out.write(`import test from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { TransactionIntent, SignerRecord, SignatureBundle } from '../types.js';
import { canonicalizeIntent } from '../canonical.js';
import { authorizeIntent } from '../authorization.js';

function createTestSignerAndSig(intent: TransactionIntent) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const canonical = canonicalizeIntent(intent);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf-8'), privateKey);

  return {
    publicKeyHex: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    signatureBundle: {
      signerPublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
      signature: signature.toString('hex'),
    } as SignatureBundle,
    signerRecord: {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
      revoked: false,
      weight: 1,
    } as SignerRecord,
  };
}

test('valid threshold authorization succeeds', () => {
  const intent: TransactionIntent = {
    idempotencyKey: 'idemp-001',
    nonce: 101,
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    sourceChain: 'solana',
    destinationChain: 'solana',
    destinationAddress: '11111111111111111111111111111111',
    tokenMint: 'So11111111111111111111111111111111111111112',
    amount: '1000000',
    maxSlippageBps: 50,
  };

  const { publicKeyHex, signatureBundle, signerRecord } = createTestSignerAndSig(intent);
  const signers = new Map([[publicKeyHex, signerRecord]]);

  const result = authorizeIntent(intent, [signatureBundle], signers, 1);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.approvedSigners.length, 1);
});

test('expired intent fails', () => {
  const intent: TransactionIntent = {
    idempotencyKey: 'idemp-002',
    nonce: 102,
    timestamp: Date.now() - 120000,
    expiresAt: Date.now() - 60000,
    sourceChain: 'solana',
    destinationChain: 'solana',
    destinationAddress: '11111111111111111111111111111111',
    tokenMint: 'So11111111111111111111111111111111111111112',
    amount: '1000000',
    maxSlippageBps: 50,
  };

  const { publicKeyHex, signatureBundle, signerRecord } = createTestSignerAndSig(intent);
  const signers = new Map([[publicKeyHex, signerRecord]]);

  const result = authorizeIntent(intent, [signatureBundle], signers, 1);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'intent expired');
});

test('nonce replay fails', () => {
  const intent: TransactionIntent = {
    idempotencyKey: 'idemp-003',
    nonce: 103,
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    sourceChain: 'solana',
    destinationChain: 'solana',
    destinationAddress: '11111111111111111111111111111111',
    tokenMint: 'So11111111111111111111111111111111111111112',
    amount: '1000000',
    maxSlippageBps: 50,
  };

  const { publicKeyHex, signatureBundle, signerRecord } = createTestSignerAndSig(intent);
  const signers = new Map([[publicKeyHex, signerRecord]]);
  const seenNonces = new Set<number>([103]);

  const result = authorizeIntent(intent, [signatureBundle], signers, 1, seenNonces);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'nonce replay');
});

test('revoked signer fails', () => {
  const intent: TransactionIntent = {
    idempotencyKey: 'idemp-004',
    nonce: 104,
    timestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    sourceChain: 'solana',
    destinationChain: 'solana',
    destinationAddress: '11111111111111111111111111111111',
    tokenMint: 'So11111111111111111111111111111111111111112',
    amount: '1000000',
    maxSlippageBps: 50,
  };

  const { publicKeyHex, signatureBundle, signerRecord } = createTestSignerAndSig(intent);
  signerRecord.revoked = true;
  const signers = new Map([[publicKeyHex, signerRecord]]);

  const result = authorizeIntent(intent, [signatureBundle], signers, 1);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'unknown or revoked signer');
});
`);
out.end();
