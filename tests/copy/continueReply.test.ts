import test from 'node:test';
import assert from 'node:assert/strict';
import { looksMidSentence, shouldContinue, REPLY_MAX_TOKENS, MAX_CONTINUES } from '../../src/lib/continueReply.ts';

test('token budget is a high safety cap, and several continues are allowed', () => {
  assert.equal(REPLY_MAX_TOKENS, 16384);
  assert.equal(MAX_CONTINUES, 3);
});

test('Jenny-style mid-sentence cuts are detected', () => {
  const strip = 'A careful historian would say we need to strip';
  const historical = 'A historian would compare the ledgers for each historical';
  const apply = 'Contradictory accounts cannot be taken at face value. Instead, they apply';
  assert.equal(looksMidSentence(strip), true);
  assert.equal(looksMidSentence(historical), true);
  assert.equal(looksMidSentence(apply), true);
  assert.equal(looksMidSentence('The method ends here.'), false);
  assert.equal(looksMidSentence('Shall we keep going?'), false);
  assert.equal(looksMidSentence('Wow!'), false); // too short
});

test('shouldContinue: length always continues; missing finish + mid-sentence continues; stop + period does not', () => {
  const cut = 'A careful historian would say we need to strip';
  const done = 'That is the whole method.';
  assert.equal(shouldContinue('length', done), true);
  assert.equal(shouldContinue(undefined, cut), true);
  assert.equal(shouldContinue('stop', cut), true);
  assert.equal(shouldContinue('stop', done), false);
  assert.equal(shouldContinue('aborted', cut), false);
  assert.equal(shouldContinue('content_filter', cut), false);
  assert.equal(shouldContinue(undefined, ''), false);
});
