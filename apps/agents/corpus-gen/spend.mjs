// Spend accounting for the corpus generator. Every model call is priced from its own returned
// usage (never trusted from the model's own claims) with the same USD-per-million-token table the
// load generator paces itself against (apps/agents/src/loadgen.mjs PRICES).
import { priceFor, priceUsage } from '../src/loadgen.mjs';

/** No --max-usd may exceed this, however it is spelled on the command line. */
export const ABSOLUTE_SPEND_CEILING_USD = 2.0;
export const DEFAULT_SPEND_CAP_USD = 0.5;

/** Worst-case USD for a call that sends `inputTokens` and is capped at `maxOutputTokens` out. */
export function estimateCallCostUsd({ inputTokens, maxOutputTokens, modelName }) {
  if (!Number.isFinite(inputTokens) || inputTokens < 0) throw new Error('inputTokens must be a non-negative number');
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < 0) throw new Error('maxOutputTokens must be a non-negative number');
  const price = priceFor(modelName);
  return (inputTokens * price.input + maxOutputTokens * price.output) / 1_000_000;
}

/** Rough token estimate for budgeting only (never sent anywhere): ~4 characters per token. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Tracks cumulative spend against a hard cap. `canAfford` is the refusal gate: a call whose own
 * worst case would push cumulative spend past the cap is never started.
 */
export function createSpendTracker({ capUsd, ceilingUsd = ABSOLUTE_SPEND_CEILING_USD } = {}) {
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--max-usd must be a positive number');
  if (capUsd > ceilingUsd) throw new Error(`--max-usd ${capUsd} exceeds the absolute ceiling of $${ceilingUsd}`);
  let spentUsd = 0;
  const calls = [];
  return {
    capUsd,
    ceilingUsd,
    get spentUsd() { return spentUsd; },
    get remainingUsd() { return Math.max(0, capUsd - spentUsd); },
    get calls() { return calls; },
    /** True when starting a call estimated at `estimateUsd` would not exceed the cap. */
    canAfford(estimateUsd) {
      if (!Number.isFinite(estimateUsd) || estimateUsd < 0) throw new Error('estimateUsd must be a non-negative number');
      return spentUsd + estimateUsd <= capUsd;
    },
    /** Records a completed call's actual usage against the ledger; returns the actual USD cost. */
    record({ estimateUsd, inputTokens, outputTokens, modelName, generationId }) {
      const actualUsd = priceUsage([{ inputTokens, outputTokens, modelName }]);
      spentUsd += actualUsd;
      calls.push({ generationId, estimateUsd, actualUsd, inputTokens, outputTokens, modelName, spentAfterUsd: spentUsd });
      return actualUsd;
    },
  };
}
