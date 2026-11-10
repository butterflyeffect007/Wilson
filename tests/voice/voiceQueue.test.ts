import test from 'node:test';
import assert from 'node:assert/strict';
import { takeChunks, withRetry, firstSuccess, createOrderedSpeaker, FatalVoiceError } from '../../src/lib/voiceQueue.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Feed a reply token-by-token like the model stream does; return every chunk in order. */
function streamChunks(text: string, step = 3): string[] {
  const out: string[] = []; let offset = 0, first = true;
  for (let n = step; n < text.length; n += step) {
    const r = takeChunks(text.slice(0, n), offset, false, first); offset = r.next;
    if (r.parts.length) first = false; out.push(...r.parts);
  }
  const r = takeChunks(text, offset, true, first); out.push(...r.parts);
  return out;
}

const REPLY = `Sure thing, Jenny. The grid is tight today but nothing to act on.\n\nHere's the second paragraph, which is longer and keeps going with several clauses, commas, and a few more words so it has to be split somewhere sensible without cutting a word in half. Third sentence here! And a question at the end?`;

test('chunker: every word is kept, in order, nothing duplicated', () => {
  const parts = streamChunks(REPLY);
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), REPLY.replace(/\s+/g, ' ').trim());
});

test('chunker: first sentence is emitted on its own as soon as it ends', () => {
  const r = takeChunks('Sure thing, Jenny. The grid is', 0, false, true);
  assert.deepEqual(r.parts, ['Sure thing, Jenny.']);
});

test('chunker: never cuts inside a word', () => {
  const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu '.repeat(4);
  const parts = streamChunks(words, 5);
  const all = new Set(words.trim().split(/\s+/));
  for (const p of parts) for (const w of p.split(/\s+/)) assert.ok(all.has(w), `split word: ${w}`);
});

test('retry: retries the same function with backoff, then succeeds', async () => {
  let calls = 0; const waits: number[] = [];
  const v = await withRetry(async () => { calls++; if (calls < 3) throw new Error('502'); return 'ok'; },
    { attempts: 4, backoffMs: [10, 20, 30], sleep: async (ms) => { waits.push(ms); } });
  assert.equal(v, 'ok'); assert.equal(calls, 3); assert.deepEqual(waits, [10, 20]);
});

test('retry: fatal errors (daily limit) are not retried', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new FatalVoiceError('limit', 'limit'); }, { attempts: 4, backoffMs: [1] }), /limit/);
  assert.equal(calls, 1);
});

test('hedge: first success wins even if the other request fails', async () => {
  const v = await firstSuccess([Promise.reject(new Error('closed without audio')), sleep(5).then(() => 'clip')]);
  assert.equal(v, 'clip');
});

test('speaker: plays every piece strictly in order even when later pieces finish first', async () => {
  const played: number[] = []; let ended: any = null;
  const sp = createOrderedSpeaker<number>({
    concurrency: 3, stopped: () => false,
    synth: async (_t, i) => { await sleep([30, 5, 1, 12, 2][i] ?? 1); return i; },
    play: async (c) => { played.push(c); await sleep(2); return true; },
    onEnd: (r) => { ended = r; },
  });
  for (const t of ['a', 'b', 'c', 'd', 'e']) sp.push(t);
  sp.finish();
  while (!ended) await sleep(5);
  assert.deepEqual(played, [0, 1, 2, 3, 4]);
  assert.deepEqual(ended, { played: 5, total: 5, down: false });
});

test('speaker: prefetches the next pieces while one is playing (parallel synth)', async () => {
  let maxInflight = 0, inflight = 0; let ended = false;
  const sp = createOrderedSpeaker<number>({
    concurrency: 3, stopped: () => false,
    synth: async (_t, i) => { inflight++; maxInflight = Math.max(maxInflight, inflight); await sleep(10); inflight--; return i; },
    play: async () => { await sleep(15); return true; },
    onEnd: () => { ended = true; },
  });
  for (let i = 0; i < 6; i++) sp.push('x' + i);
  sp.finish();
  while (!ended) await sleep(5);
  assert.equal(maxInflight, 3);
});

test('speaker: a failed piece stops the reply (no skipping ahead) and reports down', async () => {
  const played: number[] = []; let down: number | null = null; let ended: any = null;
  const sp = createOrderedSpeaker<number>({
    concurrency: 2, stopped: () => false,
    synth: async (_t, i) => { await sleep(2); if (i === 2) throw new Error('voice down'); return i; },
    play: async (c) => { played.push(c); return true; },
    onDown: (i) => { down = i; }, onEnd: (r) => { ended = r; },
  });
  for (let i = 0; i < 5; i++) sp.push('p' + i);
  sp.finish();
  while (!ended) await sleep(5);
  assert.deepEqual(played, [0, 1]); // never jumps to piece 3/4 after piece 2 failed
  assert.equal(down, 2); assert.equal(ended.down, true);
});

test('speaker: a playback hiccup replays the same clip once instead of dropping it', async () => {
  const plays: number[] = []; let ended: any = null; let failedOnce = false;
  const sp = createOrderedSpeaker<number>({
    concurrency: 2, stopped: () => false,
    synth: async (_t, i) => i,
    play: async (c) => { plays.push(c); if (c === 1 && !failedOnce) { failedOnce = true; return false; } return true; },
    onEnd: (r) => { ended = r; },
  });
  ['a', 'b', 'c'].forEach((t) => sp.push(t)); sp.finish();
  while (!ended) await sleep(5);
  assert.deepEqual(plays, [0, 1, 1, 2]); assert.equal(ended.played, 3);
});

test('speaker: pieces pushed while streaming (after earlier ones played) are still spoken', async () => {
  const played: string[] = []; let ended = false;
  const sp = createOrderedSpeaker<string>({
    concurrency: 3, stopped: () => false,
    synth: async (t) => t, play: async (c) => { played.push(c); return true; }, onEnd: () => { ended = true; },
  });
  sp.push('one'); await sleep(10); sp.push('two'); await sleep(10); sp.push('three'); sp.finish();
  while (!ended) await sleep(5);
  assert.deepEqual(played, ['one', 'two', 'three']);
});

test('speaker: stop cancels cleanly', async () => {
  let stop = false; const played: number[] = []; let ended = false;
  const sp = createOrderedSpeaker<number>({
    concurrency: 3, stopped: () => stop,
    synth: async (_t, i) => { await sleep(3); return i; },
    play: async (c) => { played.push(c); if (c === 1) stop = true; await sleep(2); return true; },
    onEnd: () => { ended = true; },
  });
  for (let i = 0; i < 6; i++) sp.push('x'); sp.finish();
  while (!ended) await sleep(5);
  assert.deepEqual(played, [0, 1]);
});
