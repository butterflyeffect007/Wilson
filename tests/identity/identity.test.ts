import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCompanionName, prettyUsername, isArchitectReservedName, buildAddresseeContext, WILSON_SYSTEM_CONTEXT, WILSON_ARCHITECT_CONTEXT } from '../../src/core/wilson/WilsonIdentity.ts';
import { extractFacts } from '../../src/core/wilson/WilsonLearning.ts';

test('prettyUsername turns account handles into spoken names', () => {
  assert.equal(prettyUsername('maya_rose'), 'Maya Rose');
  assert.equal(prettyUsername('sam'), 'Sam');
  assert.equal(prettyUsername(''), '');
});

test('Architect reserved names do not fire when they ARE the account username', () => {
  assert.equal(isArchitectReservedName('Jenny', ''), true);
  assert.equal(isArchitectReservedName('The Architect', 'maya'), true);
  assert.equal(isArchitectReservedName('Jenny', 'jenny'), false);
});

test('resolveCompanionName: Architect stays Jenny (or her chosen display name)', () => {
  assert.equal(resolveCompanionName({ isArchitect: true }), 'Jenny');
  assert.equal(resolveCompanionName({ isArchitect: true, displayName: 'Jen' }), 'Jen');
  assert.equal(resolveCompanionName({ isArchitect: true, spokenName: 'Jennifer' }), 'Jennifer');
});

test('resolveCompanionName: a new account is their username, never Jenny', () => {
  assert.equal(resolveCompanionName({ isArchitect: false, accountUsername: 'maya_rose' }), 'Maya Rose');
  assert.equal(resolveCompanionName({ isArchitect: false, displayName: 'Jenny', accountUsername: 'maya_rose' }), 'Maya Rose');
  assert.equal(resolveCompanionName({ isArchitect: false, displayName: 'Maya', accountUsername: 'maya_rose' }), 'Maya');
});

test('resolveCompanionName: unknown visitor is not called Jenny', () => {
  assert.equal(resolveCompanionName({ isArchitect: false }), null);
  assert.equal(resolveCompanionName({ isArchitect: false, displayName: 'Jenny' }), null);
  assert.equal(resolveCompanionName({ isArchitect: false, displayName: 'Sam' }), 'Sam');
});

test('base identity no longer says the current user is The Only One', () => {
  assert.equal(/The user is "The Only One"/.test(WILSON_SYSTEM_CONTEXT), false);
  assert.match(WILSON_SYSTEM_CONTEXT, /Jenny is The Architect and The Only One/);
  assert.equal(/Jobs room/.test(WILSON_SYSTEM_CONTEXT), false);
});

test('Architect addendum keeps Jenny, Jobs, and Caitlin; other people get their own name', () => {
  assert.match(WILSON_ARCHITECT_CONTEXT, /speaking with Jenny, The Architect/);
  assert.match(WILSON_ARCHITECT_CONTEXT, /Jobs room/);
  assert.match(WILSON_ARCHITECT_CONTEXT, /Caitlin/);

  const named = buildAddresseeContext({ isArchitect: false, personName: 'Maya Rose' });
  assert.match(named, /speaking with Maya Rose/);
  assert.match(named, /not Jenny, not The Architect, and not The Only One/);
  assert.equal(/Jobs room/.test(named), false);
  assert.equal(/Caitlin/.test(named), false);

  const unknown = buildAddresseeContext({ isArchitect: false, personName: null });
  assert.match(unknown, /has not given their name yet/);
  assert.match(unknown, /Never call them Jenny/);
});

test('buildSystemContext wires the addressee block and keeps Architect-only Jobs', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../../src/core/wilson/WilsonCore.ts'), 'utf8');
  assert.match(src, /buildAddresseeContext\(\{ isArchitect: isArch, personName \}\)/);
  assert.match(src, /if \(ctx\.anchor && isArch\)/);
});

test('extractFacts no longer defaults the subject to Jenny', () => {
  const facts = extractFacts("I'm working on a garden mural.");
  assert.ok(facts.some((f) => f.includes('this person is working on')));
  assert.equal(facts.some((f) => f.includes('Jenny is working on')), false);
  const named = extractFacts("I'm working on a garden mural.", 'Maya');
  assert.ok(named.some((f) => f.includes('Maya is working on')));
});

test('anti-fabrication check is in the system prompt and stays silent', () => {
  assert.match(WILSON_SYSTEM_CONTEXT, /Quietly check the request for its explicit constraints/);
  assert.match(WILSON_SYSTEM_CONTEXT, /false premises, factual contradictions, or logic conflicts/);
  assert.match(WILSON_SYSTEM_CONTEXT, /Never invent sources, quotes, stats, test results, or memories/);
  assert.match(WILSON_SYSTEM_CONTEXT, /Never show this check, hidden reasoning, or <thought> blocks/);
  assert.match(WILSON_SYSTEM_CONTEXT, /Imaginative or hypothetical play is welcome when clearly framed/);
  assert.match(WILSON_SYSTEM_CONTEXT, /Don't hedge ordinary answers or add corporate refusals/);
  // The check must not instruct Wilson to print a thought / evaluation preamble.
  assert.equal(/output a <thought>|show a <thought>|use a <thought> block/i.test(WILSON_SYSTEM_CONTEXT), false);
});
