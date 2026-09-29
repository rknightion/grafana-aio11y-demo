#!/usr/bin/env node
// Grows the committed traffic corpora with a cheap model, into a review file — never straight
// into apps/corpus/readers.json or agent-host/prompts/. See docs/traffic-corpus.md for the
// review-then-commit workflow; `apps/agents/corpus-gen/accept.mjs` is the other half of it.
//
// Usage:
//   node apps/agents/corpus-gen/grow.mjs --kind reader-intent --name best-price --count 8
//   node apps/agents/corpus-gen/grow.mjs --kind reader-persona --name casual-fan --dry-run
//   node apps/agents/corpus-gen/grow.mjs --kind dev-team --name trading --max-usd 0.25
//   node apps/agents/corpus-gen/grow.mjs --kind dev-scenario --name best-price-table
//
// Required env for a real (non --dry-run) run: CORPUS_GEN_MODEL_ID (a Bedrock Haiku model id or
// inference profile ARN), AWS_REGION, plus AWS credentials with bedrock:InvokeModel on it.
// Optional: CORPUS_GEN_MODEL_NAME (defaults to a Haiku name for pricing/recording),
// AGENTO11Y_ENDPOINT/AGENTO11Y_AUTH_TENANT_ID/AGENTO11Y_AUTH_TOKEN and the standard
// OTEL_EXPORTER_OTLP_* vars for Agent Observability tracing (the run proceeds without them, with
// a warning, if they're unset).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadReaderCorpusContext, findIntent, findPersona } from './reader-corpus.mjs';
import { loadDevPrompts, promptsForTeam, promptsForScenarioStem } from './dev-prompts.mjs';
import { reviewReaderIntentCandidates, reviewReaderPersonaCandidates, reviewDevPromptCandidates } from './candidates.mjs';
import { buildGenerationPrompt } from './generation-prompt.mjs';
import { callGeneratorModel, corpusGenModelId, corpusGenRegion, corpusGenModelName, extractJsonArray } from './model-call.mjs';
import { createSpendTracker, estimateCallCostUsd, estimateTokens, DEFAULT_SPEND_CAP_USD } from './spend.mjs';
import { createCorpusGenTelemetry, createCorpusGenClient, corpusGenAgentName } from './tracing.mjs';
import { TEAMS } from './prompt-format.mjs';

export const KINDS = ['reader-persona', 'reader-intent', 'dev-team', 'dev-scenario'];
export const MAX_COUNT = 40;
export const DEFAULT_COUNT = 10;
const MAX_ATTEMPTS = 4;

export function parseArgs(argv) {
  const args = { count: DEFAULT_COUNT, maxUsd: DEFAULT_SPEND_CAP_USD, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { i++; if (i >= argv.length) throw new Error(`${arg} needs a value`); return argv[i]; };
    if (arg === '--kind') args.kind = next();
    else if (arg === '--name') args.name = next();
    else if (arg === '--count') args.count = Number(next());
    else if (arg === '--max-usd') args.maxUsd = Number(next());
    else if (arg === '--out') args.out = next();
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--corpus-module') args.corpusModule = next();
    else if (arg === '--corpus-file') args.corpusFile = next();
    else if (arg === '--prompts-dir') args.promptsDir = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!KINDS.includes(args.kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')} (got ${args.kind})`);
  if (!args.name || !String(args.name).trim()) throw new Error('--name is required');
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > MAX_COUNT) throw new Error(`--count must be an integer between 1 and ${MAX_COUNT}`);
  return args;
}

function slugForFile(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}
function defaultOutPath(kind, name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `corpus-review/${kind}-${slugForFile(name)}-${stamp}.json`;
}
function requestedOutputTokensFor(count) {
  return Math.min(4096, Math.max(512, count * 180));
}

/** Loads the few-shot context for --kind/--name. Throws a clear error for an unknown id. */
async function loadContext(args) {
  if (args.kind === 'reader-intent' || args.kind === 'reader-persona') {
    const { module: corpusModule, corpus } = await loadReaderCorpusContext({ corpusModule: args.corpusModule, corpusFile: args.corpusFile });
    if (args.kind === 'reader-intent') {
      const intent = findIntent(corpus, args.name);
      if (!intent) throw new Error(`unknown intent id: ${args.name}`);
      const personas = (corpus.personas ?? []).filter((persona) => intent.personas?.includes(persona.id));
      return { corpusModule, corpus, promptContext: { intent, personas } };
    }
    const persona = findPersona(corpus, args.name);
    if (!persona) throw new Error(`unknown persona id: ${args.name}`);
    const sampleIntents = (corpus.intents ?? []).filter((intent) => intent.personas?.includes(args.name)).slice(0, 5);
    return { corpusModule, corpus, promptContext: { persona, sampleIntents } };
  }
  const prompts = await loadDevPrompts(args.promptsDir);
  if (args.kind === 'dev-team') {
    if (!TEAMS.includes(args.name)) throw new Error(`--name must be one of ${TEAMS.join(', ')} for --kind dev-team (got ${args.name})`);
    return { promptContext: { team: args.name, examples: promptsForTeam(prompts, args.name).slice(0, 5), stem: undefined } };
  }
  const related = promptsForScenarioStem(prompts, args.name);
  const team = related[0]?.team ?? 'platform';
  if (!related.length) console.warn(`corpus-gen: no existing prompt matches scenario stem "${args.name}"; inferring team "${team}" and using general examples for style. Check/fix the "team" header in the review file before accepting if this is wrong.`);
  const fallback = prompts.filter((prompt) => !prompt.stem.startsWith('pii-'));
  return { promptContext: { team, examples: (related.length ? related : fallback).slice(0, 5), stem: args.name } };
}

/**
 * Runs one grow: builds the prompt, calls the model (batched, respecting the spend cap, retrying
 * up to MAX_ATTEMPTS while under `count`), reviews candidates, and writes the review file.
 * `deps` lets tests inject a fake model call and a fake/stub telemetry client (no network).
 */
export async function runGrow(args, deps = {}) {
  const { env = process.env, warn = console.warn, log = console.log, callModel = callGeneratorModel, telemetry, client } = deps;
  const { promptContext, corpus, corpusModule } = await loadContext(args);

  if (args.dryRun) {
    const { system, user } = buildGenerationPrompt({ kind: args.kind, name: args.name, remaining: args.count, context: promptContext });
    log(`--- system ---\n${system}\n--- user ---\n${user}`);
    return { dryRun: true, system, user };
  }

  const modelId = corpusGenModelId(env);
  const region = corpusGenRegion(env);
  const modelName = corpusGenModelName(env);
  const tracker = createSpendTracker({ capUsd: args.maxUsd });
  const ownTelemetry = telemetry ?? createCorpusGenTelemetry(env, warn);
  const ownClient = client ?? createCorpusGenClient(ownTelemetry, env, warn);
  const conversationId = `corpus-gen-${randomUUID()}`;
  const conversationTitle = `corpus-gen ${args.kind} ${args.name}`;
  const agentName = corpusGenAgentName(env);

  let corpusWorking = corpus;
  const acceptedReaderIntent = [];
  const acceptedReaderPersona = [];
  const acceptedDevPrompt = [];
  const rejected = [];
  let remaining = args.count;
  let attempt = 0;
  let stoppedForBudget = false;

  try {
    while (remaining > 0 && attempt < MAX_ATTEMPTS) {
      attempt++;
      const { system, user } = buildGenerationPrompt({ kind: args.kind, name: args.name, remaining, context: promptContext });
      const maxOutputTokens = requestedOutputTokensFor(remaining);
      const estimateUsd = estimateCallCostUsd({ inputTokens: estimateTokens(system) + estimateTokens(user), maxOutputTokens, modelName });
      if (!tracker.canAfford(estimateUsd)) {
        stoppedForBudget = true;
        warn(`corpus-gen: stopping before attempt ${attempt}: worst case $${estimateUsd.toFixed(4)} would exceed the remaining $${tracker.remainingUsd.toFixed(4)} of the $${tracker.capUsd} cap.`);
        break;
      }

      const generationId = randomUUID();
      let modelResult;
      await ownClient.startGeneration({
        id: generationId, conversationId, conversationTitle, agentName, agentVersion: 'v1', mode: 'SYNC', operationName: 'generateText',
        model: { provider: 'anthropic', name: modelName }, systemPrompt: system, maxTokens: maxOutputTokens, temperature: 0.5,
        metadata: { kind: args.kind, name: args.name, attempt }, tags: { corpusGenKind: args.kind },
      }, async (recorder) => {
        modelResult = await callModel({ modelId, region, system, prompt: user, maxTokens: maxOutputTokens });
        recorder.setResult({
          input: [{ role: 'user', content: user }], output: [{ role: 'assistant', content: modelResult.text }],
          responseModel: modelName, model: { provider: 'anthropic', name: modelName },
          usage: { ...modelResult.usage, totalTokens: modelResult.usage.inputTokens + modelResult.usage.outputTokens },
          stopReason: modelResult.stopReason,
        });
      });

      const actualUsd = tracker.record({ estimateUsd, inputTokens: modelResult.usage.inputTokens, outputTokens: modelResult.usage.outputTokens, modelName, generationId });
      log(`corpus-gen: attempt ${attempt} used ${modelResult.usage.inputTokens} in / ${modelResult.usage.outputTokens} out tokens, $${actualUsd.toFixed(4)} (cumulative $${tracker.spentUsd.toFixed(4)} of $${tracker.capUsd}).`);

      let raw;
      try { raw = extractJsonArray(modelResult.text); }
      catch (error) {
        // A malformed reply costs this attempt only; keep what earlier attempts accepted.
        rejected.push({ reason: `unparseable model output: ${error.message}`, text: modelResult.text.slice(0, 500), attempt });
        continue;
      }
      if (args.kind === 'reader-intent') {
        const review = reviewReaderIntentCandidates({ corpus: corpusWorking, intentId: args.name, raw, validateReaderCorpus: corpusModule.validateReaderCorpus });
        if (review.accepted.length) {
          corpusWorking = structuredClone(corpusWorking);
          const intent = corpusWorking.intents.find((item) => item.id === args.name);
          for (const item of review.accepted) intent[item.field] = [...(intent[item.field] ?? []), item.text];
        }
        acceptedReaderIntent.push(...review.accepted.map((item) => ({ ...item, attempt })));
        rejected.push(...review.rejected.map((item) => ({ ...item, attempt })));
        remaining = args.count - acceptedReaderIntent.length;
      } else if (args.kind === 'reader-persona') {
        const review = reviewReaderPersonaCandidates({ corpus: corpusWorking, personaId: args.name, raw, validateReaderCorpus: corpusModule.validateReaderCorpus });
        if (review.accepted.length) { corpusWorking = structuredClone(corpusWorking); corpusWorking.intents = [...(corpusWorking.intents ?? []), ...review.accepted]; }
        acceptedReaderPersona.push(...review.accepted.map((item) => ({ intent: item, attempt })));
        rejected.push(...review.rejected.map((item) => ({ ...item, attempt })));
        remaining = args.count - acceptedReaderPersona.length;
      } else {
        const existingPrompts = [...promptContext.examples, ...acceptedDevPrompt.map((item) => ({ stem: item.stem, title: item.parsed.title, turns: item.parsed.turns }))];
        const review = reviewDevPromptCandidates({ existingPrompts, raw, team: promptContext.team, stemHint: promptContext.stem });
        acceptedDevPrompt.push(...review.accepted.map((item) => ({ ...item, attempt })));
        rejected.push(...review.rejected.map((item) => ({ ...item, attempt })));
        remaining = args.count - acceptedDevPrompt.length;
      }
    }

    const candidates = [];
    let seq = 0;
    if (args.kind === 'reader-intent') for (const item of acceptedReaderIntent) candidates.push({ id: `candidate-${++seq}`, kind: args.kind, status: 'candidate', intentId: args.name, field: item.field, text: item.text, attempt: item.attempt });
    else if (args.kind === 'reader-persona') for (const item of acceptedReaderPersona) candidates.push({ id: `candidate-${++seq}`, kind: args.kind, status: 'candidate', personaId: args.name, intent: item.intent, attempt: item.attempt });
    else for (const item of acceptedDevPrompt) candidates.push({ id: `candidate-${++seq}`, kind: args.kind, status: 'candidate', stem: item.stem, file: item.file, parsed: item.parsed, attempt: item.attempt });
    for (const item of rejected) candidates.push({ id: `rejected-${++seq}`, kind: args.kind, status: 'rejected', ...item });

    const acceptedCount = candidates.filter((item) => item.status === 'candidate').length;
    const rejectedCount = candidates.filter((item) => item.status === 'rejected').length;
    const review = {
      kind: args.kind, name: args.name, requestedCount: args.count, generatedAt: new Date().toISOString(),
      model: { id: modelId, name: modelName, region },
      spend: { capUsd: tracker.capUsd, ceilingUsd: tracker.ceilingUsd, spentUsd: tracker.spentUsd, stoppedForBudget, calls: tracker.calls },
      summary: { requested: args.count, accepted: acceptedCount, rejected: rejectedCount, attempts: attempt },
      candidates,
    };
    const outPath = args.out ?? defaultOutPath(args.kind, args.name);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
    log(`corpus-gen: wrote ${acceptedCount} candidate(s) and ${rejectedCount} rejected to ${outPath} ($${tracker.spentUsd.toFixed(4)} spent of $${tracker.capUsd} cap).`);
    return { outPath, review };
  } finally {
    if (!client) await ownClient.shutdown?.();
    if (!telemetry) await ownTelemetry.shutdown?.();
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`corpus-gen: ${error.message}`); process.exitCode = 1; return; }
  try { await runGrow(args); }
  catch (error) { console.error(`corpus-gen: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
