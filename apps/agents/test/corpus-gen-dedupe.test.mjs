import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, jaccardSimilarity, isDuplicate, dedupeTexts } from '../corpus-gen/dedupe.mjs';

test('normalizeText lowercases, drops punctuation and placeholder braces, collapses whitespace', () => {
  assert.equal(normalizeText('Best price {home}  v {away}?!'), 'best price home v away');
});

test('jaccardSimilarity is 1 for identical token sets and 0 for disjoint ones', () => {
  assert.equal(jaccardSimilarity('best price for the match', 'best price for the match'), 1);
  assert.equal(jaccardSimilarity('best price for the match', 'completely unrelated topic entirely'), 0);
});

test('jaccardSimilarity treats near-identical phrasing as high similarity', () => {
  const similarity = jaccardSimilarity('best price for the match this weekend', 'best price for the match this weekend please');
  assert.ok(similarity >= 0.8, `expected >= 0.8, got ${similarity}`);
});

test('isDuplicate matches an exact normalised duplicate', () => {
  assert.ok(isDuplicate('Best price {home} v {away}?', ['best price {home} v {away}?']));
});

test('isDuplicate matches a near-duplicate above the threshold and not below it', () => {
  const existing = ['whats the best price for harbour city v northgate rovers'];
  assert.ok(isDuplicate('whats the best price for harbour city v northgate', existing, 0.8));
  assert.equal(isDuplicate('completely different question about offers', existing, 0.8), false);
});

test('dedupeTexts rejects empty strings, exact duplicates and in-batch near-duplicates', () => {
  const existing = ['best price for the fixture'];
  const candidates = ['best price for the fixture', '  ', 'a brand new distinct question', 'a brand new distinct question please'];
  const result = dedupeTexts(candidates, existing, 0.8);
  assert.deepEqual(result.accepted, ['a brand new distinct question']);
  assert.equal(result.rejected.length, 3);
  assert.equal(result.rejected[0].reason, 'duplicate');
  assert.equal(result.rejected[1].reason, 'empty');
  assert.equal(result.rejected[2].reason, 'duplicate');
});
