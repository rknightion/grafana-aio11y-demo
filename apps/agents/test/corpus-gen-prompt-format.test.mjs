import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePromptFile, formatPromptFile, slugifyStem } from '../corpus-gen/prompt-format.mjs';

const SEAM_SAMPLE = `team: trading
title: Best price table for Harbour City v Northgate Rovers
---
Need a quick best-price comparison for the fixture.
--- followup
Actually make it a CSV instead.
`;

test('parsePromptFile parses the Seam 2 header, delimiter and follow-up turns', () => {
  const parsed = parsePromptFile(SEAM_SAMPLE);
  assert.equal(parsed.team, 'trading');
  assert.equal(parsed.title, 'Best price table for Harbour City v Northgate Rovers');
  assert.equal(parsed.effort, undefined);
  assert.equal(parsed.budget, undefined);
  assert.deepEqual(parsed.turns, ['Need a quick best-price comparison for the fixture.', 'Actually make it a CSV instead.']);
});

test('parsePromptFile reads optional effort and budget', () => {
  const parsed = parsePromptFile('team: newsroom\ntitle: T\neffort: high\nbudget: 0.75\n---\nDo the thing.\n');
  assert.equal(parsed.effort, 'high');
  assert.equal(parsed.budget, 0.75);
});

test('parsePromptFile rejects a missing "---" delimiter', () => {
  assert.throws(() => parsePromptFile('team: trading\ntitle: T\nno delimiter here'), /---/);
});

test('parsePromptFile rejects an unknown header key', () => {
  assert.throws(() => parsePromptFile('team: trading\ntitle: T\nowner: bob\n---\nturn\n'), /unknown header key/);
});

test('parsePromptFile rejects an invalid team', () => {
  assert.throws(() => parsePromptFile('team: sales\ntitle: T\n---\nturn\n'), /team must be one of/);
});

test('parsePromptFile rejects an invalid effort', () => {
  assert.throws(() => parsePromptFile('team: trading\ntitle: T\neffort: extreme\n---\nturn\n'), /effort must be one of/);
});

test('parsePromptFile rejects a non-numeric or non-positive budget', () => {
  assert.throws(() => parsePromptFile('team: trading\ntitle: T\nbudget: free\n---\nturn\n'), /budget must be a positive number/);
  assert.throws(() => parsePromptFile('team: trading\ntitle: T\nbudget: -1\n---\nturn\n'), /budget must be a positive number/);
});

test('parsePromptFile rejects an empty turn', () => {
  assert.throws(() => parsePromptFile('team: trading\ntitle: T\n---\nturn one\n--- followup\n   \n'), /every turn/);
});

test('formatPromptFile . parsePromptFile round-trips', () => {
  const entry = { team: 'platform', title: 'Audit the offers feed', effort: 'medium', budget: 0.4, turns: ['First turn.', 'Second turn, a reply.'] };
  const reparsed = parsePromptFile(formatPromptFile(entry));
  assert.deepEqual(reparsed, entry);
});

test('formatPromptFile rejects the same violations parsePromptFile does', () => {
  assert.throws(() => formatPromptFile({ team: 'trading', title: '', turns: ['a'] }), /title is required/);
  assert.throws(() => formatPromptFile({ team: 'trading', title: 'T', turns: [] }), /turns must be a non-empty array/);
  assert.throws(() => formatPromptFile({ team: 'unknown', title: 'T', turns: ['a'] }), /team must be one of/);
});

test('slugifyStem derives a filesystem-safe stem and avoids collisions', () => {
  assert.equal(slugifyStem('Best price table!'), 'best-price-table');
  assert.equal(slugifyStem('Best price table!', ['best-price-table']), 'best-price-table-2');
  assert.equal(slugifyStem('Best price table!', ['best-price-table', 'best-price-table-2']), 'best-price-table-3');
});
