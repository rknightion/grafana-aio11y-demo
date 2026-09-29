import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCallCostUsd, estimateTokens, createSpendTracker, ABSOLUTE_SPEND_CEILING_USD } from '../corpus-gen/spend.mjs';
import { priceFor } from '../src/loadgen.mjs';

test('estimateCallCostUsd matches the loadgen price table', () => {
  const price = priceFor('claude-haiku-4-5');
  const expected = (1000 * price.input + 500 * price.output) / 1_000_000;
  assert.equal(estimateCallCostUsd({ inputTokens: 1000, maxOutputTokens: 500, modelName: 'claude-haiku-4-5' }), expected);
});

test('estimateCallCostUsd rejects invalid token counts', () => {
  assert.throws(() => estimateCallCostUsd({ inputTokens: -1, maxOutputTokens: 10, modelName: 'haiku' }), /inputTokens/);
  assert.throws(() => estimateCallCostUsd({ inputTokens: 10, maxOutputTokens: NaN, modelName: 'haiku' }), /maxOutputTokens/);
});

test('estimateTokens is a rough, deterministic character-based estimate', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(40)), 10);
});

test('createSpendTracker refuses a --max-usd above the absolute ceiling', () => {
  assert.throws(() => createSpendTracker({ capUsd: ABSOLUTE_SPEND_CEILING_USD + 0.01 }), /exceeds the absolute ceiling/);
});

test('createSpendTracker refuses a non-positive cap', () => {
  assert.throws(() => createSpendTracker({ capUsd: 0 }), /positive number/);
  assert.throws(() => createSpendTracker({ capUsd: -1 }), /positive number/);
});

test('canAfford refuses a call whose worst case would exceed the remaining cap, and allows one that fits', () => {
  const tracker = createSpendTracker({ capUsd: 0.1 });
  assert.ok(tracker.canAfford(0.05));
  tracker.record({ estimateUsd: 0.05, inputTokens: 1000, outputTokens: 1000, modelName: 'claude-haiku-4-5' });
  const spentSoFar = tracker.spentUsd;
  assert.ok(spentSoFar > 0);
  assert.equal(tracker.canAfford(0.1 - spentSoFar + 0.01), false);
  assert.ok(tracker.canAfford(0.1 - spentSoFar - 0.0001));
});

test('record prices the actual call from real usage, not the estimate, and accumulates spentUsd', () => {
  const tracker = createSpendTracker({ capUsd: 1 });
  const price = priceFor('claude-haiku-4-5');
  const actual = tracker.record({ estimateUsd: 0.5, inputTokens: 2000, outputTokens: 1000, modelName: 'claude-haiku-4-5', generationId: 'g1' });
  const expected = (2000 * price.input + 1000 * price.output) / 1_000_000;
  assert.equal(actual, expected);
  assert.equal(tracker.spentUsd, expected);
  assert.equal(tracker.calls.length, 1);
  assert.equal(tracker.calls[0].generationId, 'g1');
  assert.equal(tracker.calls[0].actualUsd, expected);
});
