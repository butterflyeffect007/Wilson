import test from 'node:test';
import assert from 'node:assert/strict';
import { isPersonalThread, isPersonalRecap } from '../../src/lib/quietFilter.ts';

test('build/dashboard/self-fix threads are not treated as personal memory', () => {
  assert.equal(isPersonalThread({ id: '1', title: 'Garden mural', status: 'active', next: 'Buy paint', decision: '', date: '2026-11-26' }), true);
  assert.equal(isPersonalThread({ id: '2', title: 'self-fix loop', status: 'active', next: 'rerun', decision: '', date: '2026-11-26' }), false);
  assert.equal(isPersonalThread({ id: '3', title: 'Pages deploy', status: 'active', next: 'preview/pr-41', decision: '', date: '2026-11-26' }), false);
  assert.equal(isPersonalThread({ id: '4', title: 'Garden mural', status: 'done', next: '', decision: '', date: '2026-11-20' }), false);
  assert.equal(isPersonalRecap('We talked about Charlie and the storm.'), true);
  assert.equal(isPersonalRecap('Deployed preview/pr-41 and watched GitHub Actions.'), false);
});
