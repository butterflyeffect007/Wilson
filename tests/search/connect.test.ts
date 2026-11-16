import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTools, toolContext, runQuantumLive, KEYWORD_ONLY, TEXAS_ASK } from '../../src/intelligence/tools/index';
import { liveBrowserConfig } from '../../src/operator/settings';

for (const q of ['What is ERCOT peak demand this week?', 'how are mortgage rates right now', "what's the fed funds rate", 'how is the Texas grid doing', 'show me the macro score']) {
  test(`texas data routing: ${q}`, () => { assert.ok(detectTools(q).some((c) => c.name === 'texas')); });
}
test('texas regex leaves unrelated chat alone', () => {
  for (const q of ['I love Texas barbecue', 'tell me a story about the grid in my notebook', 'hello Wilson']) assert.ok(!TEXAS_ASK.test(q), q);
});

test('live quantum is keyword-only and never on a non-Architect device', () => {
  assert.ok(KEYWORD_ONLY.has('qlive') && KEYWORD_ONLY.has('operator'));
  const calls = detectTools('run a quantum job');
  assert.ok(!calls.some((c) => c.name === 'qlive'));
  assert.ok(calls.some((c) => c.name === 'quantum'), 'still shows the saved result');
});

function architect() {
  const store = new Map([['wilson_architect_key', 'k'], ['wilson_is_admin', '1']]);
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
}
test('Architect device: run / status / random / operator hint', () => {
  architect();
  try {
    assert.deepEqual(detectTools('Wilson, run a quantum job'), [{ name: 'qlive', params: { action: 'run', kind: 'bell' } }]);
    assert.equal(detectTools('start a quantum random number')[0].params?.kind, 'random');
    assert.deepEqual(detectTools('quantum status?'), [{ name: 'qlive', params: { action: 'status' } }]);
    assert.ok(detectTools('fill out the grant application on their website').some((c) => c.name === 'operator'));
    assert.ok(!detectTools('what is quantum computing').some((c) => c.name === 'qlive'));
  } finally { delete (globalThis as any).localStorage; }
});

test('runQuantumLive sends the Architect key and treats busy/budget as answers', async () => {
  const real = globalThis.fetch; let seen: any;
  (globalThis as any).fetch = async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ ok: false, status: 'queued', error: 'one at a time' }), { status: 409 }); };
  try {
    const r = await runQuantumLive('https://w.example/', { action: 'run', kind: 'random' }, 'secret');
    assert.equal(seen.url, 'https://w.example/quantum/run'); assert.equal(seen.init.headers.Authorization, 'Bearer secret');
    assert.equal(JSON.parse(seen.init.body).kind, 'random'); assert.equal(r.ok, true);
    assert.equal((await runQuantumLive('https://w.example', { action: 'status' }, '')).ok, false);
  } finally { globalThis.fetch = real; }
});

test('quantum + operator context wording', () => {
  const sim = toolContext([{ name: 'qlive', ok: true, data: { simulated: true, why_simulated: 'IBM account suspended' }, sources: [] }]);
  assert.match(sim, /SIMULATED/);
  const op = toolContext([{ name: 'operator', ok: true, data: { hint: 'Offer Operator mode' }, sources: [] }]);
  assert.match(op, /Operator mode/);
});

test('operator live browser goes through Wilson backend for the Architect', () => {
  const base = { groqKey: '', groqModel: '', browserUrl: '', browserToken: '', snapshots: true };
  assert.equal(liveBrowserConfig(base, { isArchitect: false, key: '' }), null);
  const w = liveBrowserConfig(base, { isArchitect: true, key: 'adm' })!;
  assert.equal(w.via, 'wilson'); assert.match(w.url, /\/operator$/); assert.equal(w.token, 'adm');
  assert.equal(liveBrowserConfig({ ...base, browserUrl: 'https://b', browserToken: 't' }, { isArchitect: true, key: 'adm' })!.via, 'own');
});
