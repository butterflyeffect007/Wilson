import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { authorizeIntent } from '../authorization.js';
import { canonicalizeIntent } from '../canonical.js';
import { executeAuthorizedIntent, SqliteNonceReservationStore } from '../execution.js';
import type { SignerRecord, SignatureBundle, TransactionIntent } from '../types.js';

const NOW = 2_000_000_000_000;
function makeIntent(nonce = 7): TransactionIntent {
  return { nonce, expiry: NOW + 60_000, tokenMint: 'mint', amount: '10' };
}
function makeSigner(intent: TransactionIntent) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
  const signature = crypto.sign(null, Buffer.from(canonicalizeIntent(intent), 'utf8'), pair.privateKey).toString('hex');
  return {
    publicKey,
    bundle: { signerPublicKey: publicKey, signature } as SignatureBundle,
    record: { publicKey, revoked: false, weight: 1 } as SignerRecord,
  };
}
function registryOf(...signers: ReturnType<typeof makeSigner>[]): Map<string, SignerRecord> {
  return new Map<string, SignerRecord>(signers.map((signer) => [signer.publicKey, signer.record] as const));
}

test('distinct verified Ed25519 signers satisfy a threshold of two', () => {
  const intent = makeIntent(); const a = makeSigner(intent); const b = makeSigner(intent);
  const result = authorizeIntent(intent, [a.bundle, b.bundle], registryOf(a, b), 2, NOW);
  assert.equal(result.success, true);
  assert.deepEqual(result.approvedSigners, [a.publicKey, b.publicKey]);
});

test('the same signer cannot inflate threshold with a repeated bundle', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  const result = authorizeIntent(intent, [a.bundle, a.bundle], registryOf(a), 1, NOW);
  assert.equal(result.reason, 'duplicate signer submission');
  assert.equal(result.success, false);
});

test('duplicate identity is rejected even when repeated signature differs', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  const result = authorizeIntent(intent, [a.bundle, { ...a.bundle, signature: '00'.repeat(64) }], registryOf(a), 1, NOW);
  assert.equal(result.reason, 'duplicate signer submission');
});

test('valid plus revoked signer below threshold preserves exact failure reason', () => {
  const intent = makeIntent(); const a = makeSigner(intent); const b = makeSigner(intent); b.record.revoked = true;
  const result = authorizeIntent(intent, [a.bundle, b.bundle], registryOf(a, b), 2, NOW);
  assert.equal(result.reason, 'unknown or revoked signer');
});

test('unknown or revoked extras do not invalidate an already satisfied quorum', () => {
  const intent = makeIntent(); const a = makeSigner(intent); const b = makeSigner(intent); const c = makeSigner(intent);
  c.record.revoked = true;
  assert.equal(authorizeIntent(intent, [a.bundle, b.bundle, c.bundle], registryOf(a, b, c), 2, NOW).success, true);
});

test('invalid signatures and malformed encodings fail closed', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  assert.equal(authorizeIntent(intent, [{ ...a.bundle, signature: '00'.repeat(64) }], registryOf(a), 1, NOW).reason, 'invalid signature');
  assert.equal(authorizeIntent(intent, [{ ...a.bundle, signature: 'xyz' }], registryOf(a), 1, NOW).reason, 'malformed signature bundle');
});

test('malformed keys and registry identity mismatches fail closed', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  assert.equal(authorizeIntent(intent, [{ ...a.bundle, signerPublicKey: 'abcd' }], registryOf(a), 1, NOW).success, false);
  assert.equal(authorizeIntent(intent, [a.bundle], new Map([['abcd', a.record]]), 1, NOW).success, false);
  assert.equal(authorizeIntent(intent, [a.bundle], new Map([[a.publicKey, { ...a.record, publicKey: 'abcd' }]]), 1, NOW).success, false);
});

test('case-folded duplicate registry identities are rejected', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  const duplicate = new Map([[a.publicKey, a.record], [a.publicKey.toUpperCase(), a.record]]);
  assert.equal(authorizeIntent(intent, [a.bundle], duplicate, 1, NOW).success, false);
});

test('thresholds must be positive safe integers within registered signer population', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  for (const threshold of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(authorizeIntent(intent, [a.bundle], registryOf(a), threshold, NOW).success, false);
  }
});

test('missing, conflicting, non-finite and malformed expiration fail closed', () => {
  const intent = makeIntent(); const a = makeSigner(intent); const signers = registryOf(a);
  const missing = { nonce: 7, tokenMint: 'mint', amount: '10' } as TransactionIntent;
  const malformed = { ...intent, expiry: Number.NaN };
  const conflicting = { ...intent, expiresAt: NOW + 30_000 };
  assert.equal(authorizeIntent(missing, [a.bundle], signers, 1, NOW).success, false);
  assert.equal(authorizeIntent(malformed, [a.bundle], signers, 1, NOW).success, false);
  assert.equal(authorizeIntent(conflicting, [a.bundle], signers, 1, NOW).success, false);
});

test('now equal to expiry is expired', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  assert.equal(authorizeIntent(intent, [a.bundle], registryOf(a), 1, NOW + 60_000).reason, 'intent expired');
});

test('canonicalization sorts keys and rejects unsupported values', () => {
  assert.equal(canonicalizeIntent({ z: 1, a: 2 } as TransactionIntent), '{"a":2,"z":1}');
  assert.throws(() => canonicalizeIntent({ ...makeIntent(), extra: undefined }));
  assert.throws(() => canonicalizeIntent({ ...makeIntent(), extra: Number.NaN }));
  assert.throws(() => canonicalizeIntent({ ...makeIntent(), extra: Infinity }));
  assert.throws(() => canonicalizeIntent({ ...makeIntent(), extra: 1n }));
  assert.throws(() => canonicalizeIntent({ ...makeIntent(), extra: new Date() }));
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.throws(() => canonicalizeIntent(circular as TransactionIntent));
  const accessor = Object.defineProperty({ ...makeIntent() }, 'danger', { enumerable: true, get: () => 'value' });
  assert.throws(() => canonicalizeIntent(accessor));
});

test('authorization returns an immutable snapshot without mutating the caller intent', () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  const result = authorizeIntent(intent, [a.bundle], registryOf(a), 1, NOW);
  assert.equal(result.success, true);
  assert.notEqual(result.verifiedIntent, intent);
  assert.equal(Object.isFrozen(result.verifiedIntent), true);
  assert.equal(intent.expiry, NOW + 60_000);
});

test('SQLite nonce reservation is unique per scope and nonce', () => {
  const db = new DatabaseSync(':memory:');
  const storeA = new SqliteNonceReservationStore(db, 'solana:wallet-A');
  const storeB = new SqliteNonceReservationStore(db, 'solana:wallet-A');
  assert.equal(storeA.reserve(9, 'a'.repeat(64)), true);
  assert.equal(storeB.reserve(9, 'b'.repeat(64)), false);
  const otherScope = new SqliteNonceReservationStore(db, 'solana:wallet-B');
  assert.equal(otherScope.reserve(9, 'c'.repeat(64)), true);
  db.close();
});

test('execution reserves before executor and retains nonce after uncertain failure', async () => {
  const intent = makeIntent(); const a = makeSigner(intent);
  const db = new DatabaseSync(':memory:');
  const store = new SqliteNonceReservationStore(db, 'test:wallet');
  let calls = 0;
  const result = await executeAuthorizedIntent(intent, [a.bundle], registryOf(a), 1, NOW, store, async () => {
    calls++;
    throw new Error('simulated uncertain outcome');
  });
  assert.equal(result.reason, 'execution failed; nonce remains consumed');
  assert.equal(calls, 1);
  const replay = await executeAuthorizedIntent(intent, [a.bundle], registryOf(a), 1, NOW, store, async () => {
    calls++;
    return 'must not run';
  });
  assert.equal(replay.reason, 'nonce replay');
  assert.equal(calls, 1);
  db.close();
});
