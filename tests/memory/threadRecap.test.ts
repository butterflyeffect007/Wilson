import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_WINDOW, buildThreadRecap, needsVoiceDiagnostics } from '../../src/lib/threadRecap.ts';

test('CONTEXT_WINDOW stays 10 so the live turn budget does not change', () => {
  assert.equal(CONTEXT_WINDOW, 10);
});

test('short threads produce no recap', () => {
  const msgs = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Turn ${i}.` }));
  assert.equal(buildThreadRecap(msgs, 10), '');
});

test('earlier turns are kept once the window is exceeded', () => {
  const msgs = [
    { role: 'user', content: 'My dog Charlie is nervous around storms.' },
    { role: 'assistant', content: 'I hear you — storms can be a lot for Charlie.' },
    ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Later turn ${i}.` })),
  ];
  const recap = buildThreadRecap(msgs, 10);
  assert.match(recap, /Earlier in this conversation/);
  assert.match(recap, /Charlie/);
  assert.doesNotMatch(recap, /Later turn 9/);
});

test('needsVoiceDiagnostics is true only for voice or mic questions', () => {
  assert.equal(needsVoiceDiagnostics('Why is your voice cutting out?'), true);
  assert.equal(needsVoiceDiagnostics('The microphone is not picking me up.'), true);
  assert.equal(needsVoiceDiagnostics('How is Charlie today?'), false);
});
