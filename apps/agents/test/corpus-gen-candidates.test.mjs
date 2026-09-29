import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewReaderIntentCandidates, reviewReaderPersonaCandidates, reviewDevPromptCandidates } from '../corpus-gen/candidates.mjs';
import { baseCorpus } from '../corpus-gen/test-support.mjs';

// A faithful-enough stand-in for Seam 1's validateReaderCorpus (see test-support.mjs's fixture
// module for the fuller version used by the grow/accept integration tests).
function validateReaderCorpus(corpus) {
  const errors = [];
  const personaIds = new Set((corpus.personas ?? []).map((persona) => persona.id));
  const intentIds = new Set();
  for (const intent of corpus.intents ?? []) {
    if (intentIds.has(intent.id)) errors.push(`duplicate intent id: ${intent.id}`);
    intentIds.add(intent.id);
    for (const personaId of intent.personas ?? []) if (!personaIds.has(personaId)) errors.push(`unknown persona: ${personaId}`);
    for (const text of [...(intent.phrasings ?? []), ...(intent.followups ?? [])]) {
      for (const placeholder of text.match(/\{[a-zA-Z]+\}/g) ?? []) if (!['{home}', '{away}', '{team}'].includes(placeholder)) errors.push(`disallowed placeholder ${placeholder}`);
    }
  }
  return errors;
}

test('reviewReaderIntentCandidates throws for an unknown intent id', () => {
  assert.throws(() => reviewReaderIntentCandidates({ corpus: baseCorpus(), intentId: 'no-such-intent', raw: [], validateReaderCorpus }), /unknown intent id/);
});

test('reviewReaderIntentCandidates accepts a new valid phrasing and rejects an exact duplicate of an existing one', () => {
  const raw = [
    { field: 'phrasings', text: 'best price {home} v {away}?' }, // exact duplicate of the existing phrasing
    { field: 'phrasings', text: 'cheapest odds for {home} against {away}?' },
  ];
  const { accepted, rejected } = reviewReaderIntentCandidates({ corpus: baseCorpus(), intentId: 'best-price', raw, validateReaderCorpus });
  assert.deepEqual(accepted, [{ field: 'phrasings', text: 'cheapest odds for {home} against {away}?' }]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'duplicate');
});

test('reviewReaderIntentCandidates rejects a disallowed placeholder via validateReaderCorpus', () => {
  const raw = [{ field: 'followups', text: 'what about {venue}?' }];
  const { accepted, rejected } = reviewReaderIntentCandidates({ corpus: baseCorpus(), intentId: 'best-price', raw, validateReaderCorpus });
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /disallowed placeholder/);
});

test('reviewReaderPersonaCandidates throws for an unknown persona id', () => {
  assert.throws(() => reviewReaderPersonaCandidates({ corpus: baseCorpus(), personaId: 'no-such-persona', raw: [], validateReaderCorpus }), /unknown persona id/);
});

test('reviewReaderPersonaCandidates forces personas to [personaId] and accepts a valid new intent', () => {
  const raw = [{ id: 'team-news', personas: ['some-other-persona'], phrasings: ['any news on {team}?'], followups: ['when back from injury?'] }];
  const { accepted, rejected } = reviewReaderPersonaCandidates({ corpus: baseCorpus(), personaId: 'casual-fan', raw, validateReaderCorpus });
  assert.equal(rejected.length, 0);
  assert.deepEqual(accepted, [{ id: 'team-news', personas: ['casual-fan'], phrasings: ['any news on {team}?'], followups: ['when back from injury?'] }]);
});

test('reviewReaderPersonaCandidates rejects a duplicate intent id against existing corpus and within the batch', () => {
  const raw = [
    { id: 'best-price', phrasings: ['x'] }, // already exists in baseCorpus()
    { id: 'fresh-intent', phrasings: ['any news on {team}?'] },
    { id: 'fresh-intent', phrasings: ['different text entirely, no overlap']  },
  ];
  const { accepted, rejected } = reviewReaderPersonaCandidates({ corpus: baseCorpus(), personaId: 'casual-fan', raw, validateReaderCorpus });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, 'fresh-intent');
  assert.equal(rejected.length, 2);
  assert.ok(rejected.some((item) => item.reason === 'duplicate intent id' && item.id === 'best-price'));
  assert.ok(rejected.some((item) => item.reason === 'duplicate intent id' && item.id === 'fresh-intent'));
});

test('reviewReaderPersonaCandidates rejects an intent whose phrasing near-duplicates an existing question', () => {
  const raw = [{ id: 'best-price-again', phrasings: ['best price {home} v {away}? please'] }];
  const { accepted, rejected } = reviewReaderPersonaCandidates({ corpus: baseCorpus(), personaId: 'casual-fan', raw, validateReaderCorpus });
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, 'phrasing duplicates an existing question');
});

const EXISTING_PROMPTS = [{ stem: 'best-price-table', team: 'trading', title: 'Best price table for a fixture', turns: ['Build a best-price table.'] }];

test('reviewDevPromptCandidates rejects a missing title or missing turns', () => {
  const { accepted, rejected } = reviewDevPromptCandidates({ existingPrompts: EXISTING_PROMPTS, raw: [{ turns: ['a'] }, { title: 'T' }], team: 'trading' });
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0].reason, 'missing title');
  assert.equal(rejected[1].reason, 'missing turns');
});

test('reviewDevPromptCandidates rejects a title or first turn that duplicates an existing scenario', () => {
  const { accepted, rejected } = reviewDevPromptCandidates({ existingPrompts: EXISTING_PROMPTS, raw: [{ title: 'Best price table for a fixture', turns: ['Something unrelated entirely.'] }], team: 'trading' });
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, 'duplicate of an existing scenario');
});

test('reviewDevPromptCandidates accepts a valid new prompt, formats it and assigns a unique stem', () => {
  const { accepted, rejected } = reviewDevPromptCandidates({ existingPrompts: EXISTING_PROMPTS, raw: [{ title: 'Audit the offers feed for missing 18+ text', effort: 'low', turns: ['Check every offer has the 18+ line.', 'Also flag any missing terms link.'] }], team: 'trading' });
  assert.equal(rejected.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].stem, 'audit-the-offers-feed-for-missing-18-text');
  assert.match(accepted[0].file, /^team: trading\ntitle: Audit the offers feed/);
  assert.deepEqual(accepted[0].parsed.turns, ['Check every offer has the 18+ line.', 'Also flag any missing terms link.']);
});

test('reviewDevPromptCandidates rejects an item whose fields fail Seam 2 formatting rules', () => {
  const { accepted, rejected } = reviewDevPromptCandidates({ existingPrompts: [], raw: [{ title: 'A title', effort: 'extreme', turns: ['one'] }], team: 'trading' });
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /effort must be one of/);
});
