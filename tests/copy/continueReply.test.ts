import test from 'node:test';
import assert from 'node:assert/strict';
import {
  looksMidSentence, shouldContinue, trimContinuationOverlap, continueAddedNothing,
  REPLY_MAX_TOKENS, MAX_CONTINUES,
} from '../../src/lib/continueReply.ts';

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
  assert.equal(looksMidSentence('Wow!'), false);
});

test('shouldContinue: length always continues; stop needs a strong mid-clause; missing finish + mid-sentence continues', () => {
  const cut = 'A careful historian would say we need to strip';
  const dangling = 'Contradictory accounts cannot be taken at face value. Instead, they apply';
  const done = 'That is the whole method.';
  const noPeriod = 'That is the whole method';
  assert.equal(shouldContinue('length', done), true);
  assert.equal(shouldContinue(undefined, cut), true);
  assert.equal(shouldContinue('stop', dangling), true);
  // A complete answer that just forgot a period must not trigger another pass (that causes repetition).
  assert.equal(shouldContinue('stop', noPeriod), false);
  assert.equal(shouldContinue('stop', done), false);
  assert.equal(shouldContinue('aborted', cut), false);
  assert.equal(shouldContinue('content_filter', cut), false);
  assert.equal(shouldContinue(undefined, ''), false);
});

test('trimContinuationOverlap drops a repeated tail and a continue preamble', () => {
  const prev = 'A careful historian would say we need to strip';
  const incoming = 'we need to strip the rhetoric and compare the ledgers.';
  assert.equal(trimContinuationOverlap(prev, incoming), 'the rhetoric and compare the ledgers.');
  assert.equal(
    trimContinuationOverlap(prev, 'Continuing: we need to strip the rhetoric.'),
    'the rhetoric.',
  );
  assert.equal(trimContinuationOverlap(prev, 'Sure, continuing: we need to strip the rhetoric.'), 'the rhetoric.');
  assert.equal(trimContinuationOverlap(prev, 'Sure. The next idea is new.'), 'Sure. The next idea is new.');
  assert.equal(trimContinuationOverlap('Hello.', 'Brand new sentence.'), 'Brand new sentence.');
  assert.equal(continueAddedNothing(incoming, ''), true);
  assert.equal(continueAddedNothing(incoming, 'the rhetoric and compare the ledgers.'), false);
});
