import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { TransactionIntent, SignatureBundle, AuthorizedSignerRegistry, VerificationResult } from './types.js';
import { authorizeIntent } from './authorization.js';
import { canonicalizeIntent } from './canonical.js';

export interface NonceReservationStore {
  reserve(nonce: number, intentDigest: string): boolean;
}

/** SQLite durable atomic reservation; production must use an on-disk database, not :memory:. */
export class SqliteNonceReservationStore implements NonceReservationStore {
  constructor(private readonly database: DatabaseSync, private readonly scope: string) {
    if (typeof scope !== 'string' || scope.trim().length === 0) throw new TypeError('nonce scope is required');
    database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    database.exec(
      'CREATE TABLE IF NOT EXISTS event_horizon_nonce_reservations (' +
      'scope TEXT NOT NULL, nonce INTEGER NOT NULL CHECK (nonce >= 0), ' +
      'intent_digest TEXT NOT NULL CHECK (length(intent_digest) = 64), ' +
      'reserved_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (scope, nonce)' +
      ') WITHOUT ROWID;'
    );
  }

  reserve(nonce: number, intentDigest: string): boolean {
    if (!Number.isSafeInteger(nonce) || nonce < 0 || !/^[0-9a-f]{64}$/.test(intentDigest)) {
      throw new TypeError('invalid nonce reservation');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(
        'INSERT INTO event_horizon_nonce_reservations (scope, nonce, intent_digest) VALUES (?, ?, ?) ' +
        'ON CONFLICT(scope, nonce) DO NOTHING'
      ).run(this.scope, nonce, intentDigest);
      this.database.exec('COMMIT');
      return Number(result.changes) === 1;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }
}

export interface ExecutionResult<T = never> {
  authorized: boolean;
  executed: boolean;
  reason: string;
  verification: VerificationResult;
  value?: T;
}

/** Verify, atomically reserve the nonce, then execute the immutable verified snapshot. */
export async function executeAuthorizedIntent<T>(
  intent: TransactionIntent,
  bundles: SignatureBundle[],
  registry: AuthorizedSignerRegistry,
  threshold: number,
  nowMs: number,
  reservations: NonceReservationStore,
  execute: (verifiedIntent: TransactionIntent) => Promise<T> | T,
): Promise<ExecutionResult<T>> {
  const verification = authorizeIntent(intent, bundles, registry, threshold, nowMs);
  if (!verification.success || !verification.verifiedIntent) {
    return { authorized: false, executed: false, reason: verification.reason ?? 'authorization failed', verification };
  }
  const snapshot = verification.verifiedIntent;
  const digest = crypto.createHash('sha256').update(canonicalizeIntent(snapshot), 'utf8').digest('hex');
  let reserved: boolean;
  try {
    reserved = reservations.reserve(snapshot.nonce, digest);
  } catch {
    return { authorized: false, executed: false, reason: 'nonce reservation failed', verification };
  }
  if (!reserved) return { authorized: false, executed: false, reason: 'nonce replay', verification };
  try {
    const value = await execute(snapshot);
    return { authorized: true, executed: true, reason: 'executed', verification, value };
  } catch {
    return { authorized: true, executed: false, reason: 'execution failed; nonce remains consumed', verification };
  }
}
