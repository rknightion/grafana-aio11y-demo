import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Trial } from '@grafana/agento11y/experiments';
import { loadSuite, validateSuite, resolveSuite, selectCandidates, candidateHeaders, scheduledPlan,
  experimentPayload, executeExperiment, evaluatorScore, resumePendingRun, parseArgs, resolveCandidateVersions,
  encodePendingTuple, parsePendingTuples, scheduledOverridesFromEnv, controlPlane, ensurePublishedSuite } from './run-experiment.mjs';
import { variantVersion } from '../src/variants.mjs';

const variants = ['brief', 'balanced', 'contextual'];
const ingestIdentity = { tenantId: '123456', endpoint: 'https://agento11y.example.test' };
const healthy = { ok: true, json: async () => ({ status: 'ok', service: 'touchline-orchestrator' }) };

test('schedule overrides apply only when their environment variables are set', () => {
  assert.deepEqual(scheduledOverridesFromEnv({}), {});
  assert.deepEqual(scheduledOverridesFromEnv({ EXPERIMENTS_DELAY_MS: '0',
    EXPERIMENTS_PROBABILITY: '1', EXPERIMENTS_SET: 'models' }),
  { delayMsOverride: 0, probabilityOverride: 1, candidateSet: 'models' });
  assert.throws(() => scheduledOverridesFromEnv({ EXPERIMENTS_SET: 'other' }), /models or variants/);
});

test('suite placeholders follow SERVICE_NAMESPACE and env overrides the evaluator', async () => {
  const suite = await loadSuite(undefined, {});
  assert.equal(suite.suite_id, 'touchline_match_desk_comparison');
  assert.equal(suite.online_evaluator.evaluator_id, 'touchline_answer_quality');
  assert.equal(suite.online_evaluator.version, undefined);
  assert.equal(suite.candidate.agent_name, 'touchline-orchestrator');
  const renamed = await loadSuite(undefined, { SERVICE_NAMESPACE: 'match-day', EXPERIMENTS_EVALUATOR_VERSION: '3' });
  assert.equal(renamed.suite_id, 'match_day_match_desk_comparison');
  assert.equal(renamed.online_evaluator.version, '3');
  assert.equal(renamed.candidate.agent_name, 'match-day-orchestrator');
  assert.equal(resolveSuite({ online_evaluator: { evaluator_id: 'x' } }, { EXPERIMENTS_EVALUATOR_ID: 'custom' }).online_evaluator.evaluator_id, 'custom');
});

test('suite and candidate sets keep the three cases and emit the right headers', async () => {
  const suite = await loadSuite(undefined, {});
  assert.deepEqual(suite.cases.map((item) => item.category), ['happy', 'edge', 'adversarial']);
  const models = selectCandidates(suite);
  assert.deepEqual(models.map((item) => item.id), ['haiku', 'sonnet']);
  assert.equal(candidateHeaders(models[0])['x-agent-variant'], undefined);
  const chosen = selectCandidates(suite, 'variants', variants);
  assert.deepEqual(chosen.map((item) => candidateHeaders(item)), variants.map((id) => ({
    'content-type': 'application/json', 'x-agent-model': 'haiku', 'x-agent-variant': id,
  })));
  assert.throws(() => selectCandidates(suite, 'variants', ['brief', 'brief', 'contextual']), /distinct/);
  const invalid = structuredClone(suite);
  invalid.cases[0].category = 'other';
  assert.throws(() => validateSuite(invalid), /must cover/);
  const badVariantBase = structuredClone(suite);
  badVariantBase.variant_candidate = 'opus';
  assert.throws(() => validateSuite(badVariantBase), /variant_candidate/);
  assert.equal(experimentPayload(suite, models[0], 'run-1', 'v1').candidate.model_name, 'claude-haiku-4-5');
});

test('variant run metadata matches the shipped file hash; model runs declare mixed versions', async () => {
  const suite = await loadSuite(undefined, {});
  const chosen = await resolveCandidateVersions(selectCandidates(suite, 'variants', variants));
  for (const candidate of chosen) {
    const raw = await readFile(new URL(`../src/variants/${candidate.id}.json`, import.meta.url));
    assert.equal(experimentPayload(suite, candidate, `run-${candidate.id}`, 'v1').candidate.agent_version, variantVersion(candidate.id, raw));
  }
  const model = experimentPayload(suite, selectCandidates(suite)[0], 'run-model', 'v1');
  assert.equal(model.candidate.agent_version, undefined);
  assert.equal(model.metadata.variant_version_scope, 'mixed_rotating');
});

test('seeded schedule ranges, set choice, run IDs and UTC daily cap', async () => {
  assert.deepEqual(parseArgs(['--scheduled', '--scheduled-now', '--candidate-set', 'variants', '--base-url', 'http://127.0.0.1:18080']).set, 'variants');
  const suite = await loadSuite(undefined, {});
  const env = {};
  const draws = [0.6, 0.2, 0.1];
  const now = new Date('2026-09-23T22:00:00Z');
  const plan = scheduledPlan(suite, { now, random: () => draws.shift(), variantIds: variants, existingRuns: [], env });
  assert.equal(plan.delayMs, 1_800_000);
  assert.equal(plan.fires, true);
  assert.equal(plan.set, 'variants');
  assert.deepEqual(plan.runIds, variants.map((id) => `touchline-sched-variants-${id}-20260923T2230`));
  assert.equal(plan.allowed, true);
  const existingRuns = Array.from({ length: 10 }, (_, index) => `touchline-sched-models-x${index}-20260923T1200`);
  const capped = scheduledPlan(suite, { now, random: () => 0, variantIds: variants, existingRuns, env });
  assert.equal(capped.used, 10);
  assert.equal(capped.allowed, false);
  const skipped = scheduledPlan(suite, { now, random: (() => { const values = [0, 0.9, 0.9]; return () => values.shift(); })(), variantIds: variants, env });
  assert.equal(skipped.fires, false);
  const noInventory = scheduledPlan(suite, { now, random: () => 0, candidateSet: 'variants', env });
  assert.deepEqual(noInventory.candidates.map((item) => item.id), variants);
  assert.equal(noInventory.capChecked, false);
  assert.equal(noInventory.used, null);
  assert.equal(noInventory.allowed, null);
  const forced = scheduledPlan(suite, { now, random: () => 0.9, candidateSet: 'models', immediate: true, existingRuns, env });
  assert.equal(forced.set, 'models');
  assert.equal(forced.delayMs, 0);
  assert.equal(forced.fires, true);
  assert.deepEqual(forced.runIds, suite.candidates.map((item) => `touchline-sched-models-${item.id}-20260923T2200`));
  assert.equal(forced.allowed, true, 'two model runs still fit under the default cap of 12');
  assert.equal(scheduledPlan(suite, { now, random: () => 0.9, candidateSet: 'models', immediate: true, existingRuns, env: { EXPERIMENTS_DAILY_RUN_CAP: '11' } }).allowed, false);
});

test('pending resume tuples round-trip delimiters in remote identifiers', () => {
  const entry = { trialId: 'trial:1', evaluationId: 'eval,one', testCaseId: 'case-1',
    conversationId: 'conversation:one', traceId: 'abc', spanId: '', inputTokens: 12, outputTokens: 4 };
  assert.deepEqual(parsePendingTuples(encodePendingTuple(entry)), [entry]);
});

test('SDK experiment path records model, usage, timing, artifact, trace and final score', async (t) => {
  const priorFlag = process.env.AGENTO11Y_ENABLE_EXPERIMENTAL_FEATURES;
  process.env.AGENTO11Y_ENABLE_EXPERIMENTAL_FEATURES = 'true';
  t.after(() => { if (priorFlag === undefined) delete process.env.AGENTO11Y_ENABLE_EXPERIMENTAL_FEATURES;
    else process.env.AGENTO11Y_ENABLE_EXPERIMENTAL_FEATURES = priorFlag; });
  const suite = await loadSuite(undefined, {});
  const versioned = await resolveCandidateVersions(selectCandidates(suite, 'variants', variants));
  const versions = Object.fromEntries(versioned.map((item) => [item.id, item.agent_version]));
  const headers = [];
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/healthz') { response.end(JSON.stringify({ status: 'ok', service: 'touchline-orchestrator' })); return; }
    if (request.url === '/v1/ask') {
      headers.push(request.headers);
      response.end(JSON.stringify({ conversationId: `conversation-${headers.length}`, traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16), agentVersion: versions[request.headers['x-agent-variant']], answer: 'Concise answer.',
        usage: [{ agent: 'touchline-orchestrator', model: request.headers['x-agent-model'], modelName: 'claude-haiku-4-5', inputTokens: 20, outputTokens: 5 },
          { agent: 'touchline-odds', model: 'haiku', inputTokens: 10, outputTokens: 3 }] }));
      return;
    }
    response.writeHead(404); response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const calls = [];
  const client = {
    ...ingestIdentity, nowMs: () => Date.now(),
    useExperimentalOtel: false, redactSecrets: true,
    upsertExperiment: async (request) => { calls.push(['run', request]); return { runId: request.runId }; },
    upsertTrial: async (id, request) => { calls.push(['trial', id, request]); return {}; },
    updateTrial: async (id, trialId, request) => { calls.push(['update', id, trialId, request]); return {}; },
    exportGeneration: async (request) => { calls.push(['generation', request]); return request.generationId; },
    flushGenerations: async () => {},
    uploadArtifact: async (request) => { calls.push(['artifact', request]); return { artifact_id: 'a1' }; },
    triggerTrialEvaluation: async (id, trialId) => { calls.push(['evaluate', id, trialId]); return { evaluationId: 'e1', status: 'success' }; },
    exportScores: async (scores) => { calls.push(['scores', scores]); return scores.length; },
    finalize: async (id, status) => { calls.push(['finalize', id, status]); return {}; },
  };
  const pushed = [];
  const suites = { pushSuite: async (portable, options) => { pushed.push([portable, options]); return { suiteVersion: 'v1' }; } };
  const reads = { listRuns: async () => [], getSuite: async () => null,
    listScores: async () => ({ items: [{ trialId: calls.filter((item) => item[0] === 'trial').at(-1)[2].trialId,
      evaluatorId: 'touchline_answer_quality', value: { number: 0.86 } }] }) };
  const result = await executeExperiment({ suite, baseUrl: `http://127.0.0.1:${server.address().port}`,
    runIdPrefix: 'local-test', set: 'variants', variantIds: variants, client, suites, reads, env: {} });
  assert.equal(result.runIds.length, 3);
  assert.equal(result.suiteVersion, 'v1');
  assert.equal(pushed.length, 1, 'a missing suite is published once before the runs');
  assert.equal(pushed[0][1].publish, true);
  assert.equal(pushed[0][0].testCases.length, 3);
  assert.equal(headers.length, 9);
  assert.deepEqual(headers.slice(0, 3).map((item) => item['x-agent-variant']), ['brief', 'brief', 'brief']);
  assert.deepEqual(headers.slice(3, 6).map((item) => item['x-agent-variant']), ['balanced', 'balanced', 'balanced']);
  assert.equal(calls.filter((item) => item[0] === 'run').length, 3);
  assert.equal(calls.filter((item) => item[0] === 'artifact').length, 9);
  assert.equal(calls.filter((item) => item[0] === 'scores').length, 9);
  assert.ok(calls.filter((item) => item[0] === 'scores').every((item) => item[1][0].scoreKey === 'final' && item[1][0].passed === true));
  assert.ok(calls.filter((item) => item[0] === 'generation').every((item) =>
    item[1].modelName === 'claude-haiku-4-5' && item[1].inputTokens === 20 && item[1].outputTokens === 5));
  assert.ok(calls.filter((item) => item[0] === 'update').some((item) => item[3].durationMs >= 0 && item[3].traceId === 'a'.repeat(32)));
  assert.equal(calls.filter((item) => item[0] === 'finalize' && item[2] === 'completed').length, 3);
});

test('a published suite with matching cases is reused; a missing one without a SA token fails closed', async () => {
  const suite = await loadSuite(undefined, {});
  const published = { getSuite: async () => ({ versions: [{ version: 'v1', published: true, test_case_count: 3 }, { version: 'v2', published: false, test_case_count: 3 }] }) };
  assert.equal(await ensurePublishedSuite(suite, { reads: published }), 'v1');
  await assert.rejects(ensurePublishedSuite(suite, { reads: { getSuite: async () => null } }), /AGENTO11Y_SERVICE_ACCOUNT_TOKEN/);
  const stale = { getSuite: async () => ({ versions: [{ version: 'v1', published: true, test_case_count: 2 }] }) };
  assert.equal(await ensurePublishedSuite(suite, { reads: stale, suites: { pushSuite: async () => ({ suiteVersion: 'v3' }) } }), 'v3');
});

for (const priorCount of [11, 12]) test(`scheduled cap blocks ${priorCount} existing runs before any run write`, async () => {
  const suite = await loadSuite(undefined, {});
  const writes = [];
  const events = [];
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const existing = Array.from({ length: priorCount }, (_, index) => ({ experiment_id: `touchline-sched-models-x${index}-${day}T1200` }));
  await assert.rejects(executeExperiment({ suite, baseUrl: 'http://touchline-orchestrator:8080',
    runIdPrefix: 'touchline-sched-variants', scheduled: true, set: 'variants', env: {}, log: (event) => events.push(event),
    fetchImpl: async () => healthy,
    reads: { listRuns: async () => existing, getSuite: async () => { throw new Error('suite read must not occur after cap'); } },
    client: { ...ingestIdentity, upsertExperiment: async () => writes.push('run') },
  }), /daily cap reached/);
  assert.deepEqual(writes, []);
  assert.equal(events.find((event) => event.event === 'scheduled_cap_checked')?.used, priorCount);
  assert.equal(events.find((event) => event.event === 'scheduled_cap_checked')?.allowed, false);
});

for (const badItem of [{}, { experiment_id: 42 }]) test(`scheduled inventory rejects malformed item ${JSON.stringify(badItem)} before run creation`, async () => {
  const suite = await loadSuite(undefined, {});
  const events = [];
  let suiteReads = 0;
  await assert.rejects(executeExperiment({ suite, baseUrl: 'http://touchline-orchestrator:8080',
    runIdPrefix: 'touchline-sched-models', scheduled: true, env: { AGENTO11Y_AUTH_TOKEN: 'test-ingest' }, log: (event) => events.push(event),
    fetchImpl: async (url) => {
      if (String(url).endsWith('/healthz')) return healthy;
      if (String(url).includes('/experiments?')) return { ok: true, json: async () => ({ items: [badItem] }) };
      suiteReads++;
      throw new Error('suite read must not happen after invalid inventory');
    },
    client: { ...ingestIdentity, upsertExperiment: async () => { throw new Error('unexpected run write'); } },
  }), /invalid experiment_id/);
  assert.equal(suiteReads, 0);
  assert.equal(events.at(-1)?.event, 'experiment_preflight_failed');
  assert.equal(events.some((event) => event.event === 'scheduled_cap_checked'), false);
});

test('scheduled preflight fails closed when an ingest read needs an absent SA token', async () => {
  const suite = await loadSuite(undefined, {});
  const events = [];
  let calls = 0;
  await assert.rejects(executeExperiment({ suite, baseUrl: 'http://touchline-orchestrator:8080',
    runIdPrefix: 'touchline-sched-models', scheduled: true, env: { AGENTO11Y_AUTH_TOKEN: 'test-ingest' }, log: (event) => events.push(event),
    fetchImpl: async (url) => { calls++; return String(url).endsWith('/healthz') ? healthy : { ok: false, status: 401 }; },
    client: { ...ingestIdentity, upsertExperiment: async () => { throw new Error('unexpected run write'); } },
  }), /requires AGENTO11Y_GRAFANA_URL and AGENTO11Y_SERVICE_ACCOUNT_TOKEN/);
  assert.equal(calls, 2);
  assert.equal(events.at(-1)?.event, 'experiment_preflight_failed');
});

test('manual mode refuses a non-loopback orchestrator URL', async () => {
  const suite = await loadSuite(undefined, {});
  await assert.rejects(executeExperiment({ suite, baseUrl: 'http://touchline-orchestrator:8080', runIdPrefix: 'manual',
    env: {}, reads: { listRuns: async () => [], getSuite: async () => null }, client: ingestIdentity }), /loopback/);
});

test('control-plane reads use the ingest token and paginate the complete run inventory', async () => {
  const calls = [];
  const api = controlPlane({ ...ingestIdentity, ingestToken: 'test-token', fetchImpl: async (url, options) => {
    calls.push([url, options.headers.Authorization]);
    return { ok: true, json: async () => url.includes('cursor=next')
      ? { items: [{ experiment_id: 'run-2' }] }
      : { items: [{ experiment_id: 'run-1' }], next_cursor: 'next' } };
  } });
  assert.deepEqual((await api.listRuns()).map((item) => item.experiment_id), ['run-1', 'run-2']);
  assert.ok(calls.every(([url, auth]) => url.startsWith('https://agento11y.example.test/api/v1/eval/experiments?') &&
    auth === `Basic ${Buffer.from('123456:test-token').toString('base64')}`));
});

test('experiment scores are read through the control plane, so a write-only ingest token falls back to the SA token', async () => {
  const calls = [];
  const api = controlPlane({ ...ingestIdentity, ingestToken: 'ingest', grafanaUrl: 'https://stack.example.test/', saToken: 'sa', fetchImpl: async (url, options) => {
    calls.push([url, options.headers.Authorization]);
    return String(url).startsWith('https://agento11y.') ? { ok: false, status: 401 }
      : { ok: true, json: async () => ({ items: [{ trial_id: 't1', evaluator_id: 'e1', value: { number: 0.9 } }], next_cursor: 'c2' }) };
  } });
  assert.deepEqual(await api.listScores('run 1', { limit: 100, cursor: 'c1' }),
    { items: [{ trial_id: 't1', evaluator_id: 'e1', value: { number: 0.9 } }], nextCursor: 'c2' });
  assert.equal(calls[1][0], 'https://stack.example.test/api/plugins/grafana-agento11y-app/resources/eval/experiments/run%201/scores?limit=100&cursor=c1');
  assert.equal(calls[1][1], 'Bearer sa');
  assert.equal(await evaluatorScore(api, 'run 1', 't1', 'e1'), 0.9);
});

test('control-plane read falls back to the SA token only on ingest auth rejection, and 404 means no suite', async () => {
  const calls = [];
  const api = controlPlane({ ...ingestIdentity, ingestToken: 'ingest', grafanaUrl: 'https://stack.example.test/', saToken: 'sa', fetchImpl: async (url, options) => {
    calls.push([url, options.headers.Authorization]);
    return String(url).startsWith('https://agento11y.') ? { ok: false, status: 403 }
      : { ok: true, json: async () => ({ versions: [] }) };
  } });
  assert.deepEqual(await api.getSuite('suite-1'), { versions: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], 'https://stack.example.test/api/plugins/grafana-agento11y-app/resources/eval/test-suites/suite-1');
  assert.equal(calls[1][1], 'Bearer sa');
  const missing = controlPlane({ ...ingestIdentity, ingestToken: 'ingest', fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(await missing.getSuite('absent'), null);
});

test('score retrieval fails closed on missing or nonnumeric evaluator score', async () => {
  await assert.rejects(evaluatorScore({ listScores: async () => ({ items: [] }) }, 'r', 't', 'e'), /absent/);
  await assert.rejects(evaluatorScore({ listScores: async () => ({ items: [{ trialId: 't', evaluatorId: 'e', value: { string: 'good' } }] }) }, 'r', 't', 'e'), /not numeric/);
});

test('pending evaluation resume publishes the final score before run finalization', async () => {
  const calls = [];
  const trialId = Trial.fromRef({ useExperimentalOtel: false }, { experimentId: 'run-1', testCaseId: 'case-1', attempt: 1 }).trialId;
  const client = {
    nowMs: () => Date.now(), useExperimentalOtel: false,
    getTrialEvaluation: async () => ({ status: 'success' }),
    listScores: async () => ({ items: [{ trialId, evaluatorId: 'touchline_answer_quality', value: { number: 0.7 } }] }),
    upsertTrial: async () => {},
    updateTrial: async (_run, _trial, request) => { calls.push(['trial', request.status]); },
    flushGenerations: async () => {},
    exportScores: async (scores) => { calls.push(['score', scores[0].scoreKey, scores[0].passed]); return scores.length; },
    finalize: async (_run, status) => { calls.push(['run', status]); },
  };
  await resumePendingRun(client, 'run-1', [{ trialId, evaluationId: 'eval-1', testCaseId: 'case-1', conversationId: 'conversation-1',
    traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), inputTokens: 30, outputTokens: 8 }], { evaluator: { evaluator_id: 'touchline_answer_quality' } });
  assert.deepEqual(calls.at(-1), ['run', 'completed']);
  assert.deepEqual(calls.find((item) => item[0] === 'score'), ['score', 'final', false]);
  assert.ok(calls.some((item) => item[0] === 'trial' && item[1] === 'completed'));
});
