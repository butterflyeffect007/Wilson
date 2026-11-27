import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePacks, type MemoryPack } from '../../src/lib/memoryPackMerge.ts';
import { splitSystemContext } from '../../src/lib/systemSplit.ts';

const emptySoy = { summary: '', vibes: [], turns: [], pending: 0, updatedAt: null };
const emptyQ = { intent: '', pacing: [] as string[], threads: [] as never[], recaps: [] as never[], updatedAt: 0 };

function pack(p: Partial<MemoryPack>): MemoryPack {
  return { updatedAt: 1, lessons: [], stateOfYou: emptySoy, quietMemory: emptyQ, facts: [], ...p };
}

test('mergePacks unions lessons and facts, keeping newer text', () => {
  const a = pack({
    updatedAt: 10,
    lessons: [{ id: '1', text: 'Call them Jenny.', ts: '2026-11-01' }],
    facts: [{ id: 'f1', text: 'Charlie is her dog', speakerId: 'default', emotion: null, ts: '2026-11-01' }],
  });
  const b = pack({
    updatedAt: 20,
    lessons: [{ id: '2', text: 'Be calmer about storms.', ts: '2026-11-20' }, { id: '3', text: 'call them Jenny.', ts: '2026-11-21' }],
    facts: [{ id: 'f2', text: 'Caitlin lives in Austin', speakerId: 'default', emotion: null, ts: '2026-11-20' }],
  });
  const m = mergePacks(a, b);
  assert.equal(m.updatedAt, 20);
  assert.equal(m.lessons.length, 2);
  assert.ok(m.lessons.some((l) => l.text === 'Call them Jenny.'));
  assert.ok(m.lessons.some((l) => /storms/.test(l.text)));
  assert.equal(m.facts.length, 2);
});

test('splitSystemContext keeps short prompts whole and splits long ones under 7800', () => {
  assert.deepEqual(splitSystemContext(''), []);
  assert.deepEqual(splitSystemContext('hello'), ['hello']);
  const long = Array.from({ length: 20 }, (_, i) => `Section ${i}. ${'x'.repeat(500)}`).join('\n\n');
  const parts = splitSystemContext(long);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.length <= 7800));
  assert.equal(parts.join('\n\n'), long);
});
