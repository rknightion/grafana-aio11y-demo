#!/usr/bin/env node
// Agent Observability experiment runner for the orchestrator.
//
// Two candidate sets, both against the live orchestrator over HTTP:
//   models    one run per model key in the suite (x-agent-model), current rotating variant
//   variants  one run per shipped prompt variant (x-agent-variant), pinned to one model
// Each run records one trial per suite case, asks the stack's answer-quality evaluator to score
// it, and finalizes. --scheduled is the CronJob mode: random delay, random skip, random set, a
// UTC daily run cap and a Kubernetes Lease so overlapping Jobs never double-create runs.
//
// Environment (the SDK's own names):
//   AGENTO11Y_ENDPOINT, AGENTO11Y_AUTH_TENANT_ID, AGENTO11Y_AUTH_TOKEN   experiment ingest
//   AGENTO11Y_ENABLE_EXPERIMENTAL_FEATURES=true                         required by the SDK
//   AGENTO11Y_GRAFANA_URL, AGENTO11Y_SERVICE_ACCOUNT_TOKEN              optional: publish the
//       stored test suite when it is missing, and read the control plane if ingest auth is refused
//   ORCHESTRATOR_BASE_URL or ORCHESTRATOR_URL   scheduled mode target (default http://<namespace>-orchestrator:8080)
//   EXPERIMENTS_SET, EXPERIMENTS_DELAY_MS, EXPERIMENTS_PROBABILITY      schedule overrides
//   EXPERIMENTS_DAILY_RUN_CAP (default 12), EXPERIMENTS_EVALUATOR_ID, EXPERIMENTS_EVALUATOR_VERSION
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { ExperimentsClient, Experiment, Trial, TestSuitesClient } from '@grafana/agento11y/experiments';
import { VARIANT_IDS, variantVersion } from '../src/variants.mjs';
import { agentName, serviceNamespace } from '../src/config.mjs';
import { withScheduledLease } from './lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = resolve(here, '../config/experiment-suite.yaml');
const expectedCategories = ['happy', 'edge', 'adversarial'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function dailyRunCap(env = process.env) {
  const cap = Number(env.EXPERIMENTS_DAILY_RUN_CAP ?? '12');
  if (!Number.isInteger(cap) || cap < 0) throw new Error('EXPERIMENTS_DAILY_RUN_CAP must be a non-negative integer');
  return cap;
}
const idPrefix = (env = process.env) => serviceNamespace(env).replaceAll('-', '_');
const schedPrefix = (env = process.env) => `${serviceNamespace(env)}-sched-`;

/** Fills "{prefix}" placeholders and env overrides, so one suite file serves any deployment name. */
export function resolveSuite(raw, env = process.env) {
  const fill = (value) => typeof value === 'string' ? value.replaceAll('{prefix}', idPrefix(env)) : value;
  const suite = structuredClone(raw ?? {});
  suite.suite_id = fill(suite.suite_id);
  suite.online_evaluator = { ...suite.online_evaluator, evaluator_id: fill(env.EXPERIMENTS_EVALUATOR_ID ?? suite.online_evaluator?.evaluator_id) };
  const version = env.EXPERIMENTS_EVALUATOR_VERSION ?? suite.online_evaluator.version;
  if (version === undefined || version === null || version === '') delete suite.online_evaluator.version;
  else suite.online_evaluator.version = String(version);
  if (suite.candidate) suite.candidate.agent_name = agentName(suite.candidate.agent_role ?? 'orchestrator', env);
  return suite;
}

export function validateSuite(suite) {
  if (!suite || typeof suite !== 'object' || Array.isArray(suite)) throw new Error('suite must be a YAML mapping');
  for (const field of ['suite_id', 'name', 'description', 'changelog']) {
    if (typeof suite[field] !== 'string' || !suite[field].trim()) throw new Error(`suite is missing ${field}`);
  }
  if (!ID.test(suite.suite_id)) throw new Error('suite_id must be a short stable identifier');
  if (!Array.isArray(suite.tags) || !suite.tags.length || suite.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) throw new Error('suite tags must be a non-empty list of strings');
  if (suite.candidate?.agent_role !== 'orchestrator' || suite.candidate.model_provider !== 'anthropic') {
    throw new Error('candidate must identify the Anthropic orchestrator agent');
  }
  if (!Array.isArray(suite.candidates) || !suite.candidates.length) throw new Error('suite must define at least one model candidate');
  const ids = suite.candidates.map((candidate) => candidate?.id);
  if (new Set(ids).size !== ids.length) throw new Error('candidate ids must be distinct');
  for (const candidate of suite.candidates) {
    if (!ID.test(candidate?.id ?? '') || typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.model_name !== 'string' || !candidate.model_name.trim()) {
      throw new Error(`candidate ${candidate?.id} needs an id, a name and a canonical model_name`);
    }
  }
  if (!ids.includes(suite.variant_candidate)) throw new Error('variant_candidate must name one of the candidates');
  if (!ID.test(suite.online_evaluator?.evaluator_id ?? '')) throw new Error('suite must reference an online evaluator id');
  if (!Array.isArray(suite.cases) || suite.cases.length !== expectedCategories.length) throw new Error('suite must define exactly three test cases');
  const categories = suite.cases.map((testCase) => testCase?.category);
  if (new Set(categories).size !== expectedCategories.length || expectedCategories.some((category) => !categories.includes(category))) {
    throw new Error(`suite cases must cover ${expectedCategories.join(', ')}`);
  }
  const caseIds = new Set();
  for (const testCase of suite.cases) {
    const caseId = testCase.test_case_id;
    if (!ID.test(caseId ?? '')) throw new Error('each case needs a short stable test_case_id');
    if (caseIds.has(caseId)) throw new Error(`duplicate case id ${caseId}`);
    caseIds.add(caseId);
    if (typeof testCase.name !== 'string' || !testCase.name.trim()) throw new Error(`${caseId}: name is required`);
    if (typeof testCase.description !== 'string' || !testCase.description.trim()) throw new Error(`${caseId}: description is required`);
    if (!Array.isArray(testCase.tags) || !testCase.tags.length) throw new Error(`${caseId}: tags are required`);
    if (!testCase.input || typeof testCase.input !== 'object' || Array.isArray(testCase.input)) throw new Error(`${caseId}: input must be a mapping`);
    if (typeof testCase.input.question !== 'string' || !testCase.input.question.trim() || testCase.input.question.length > 2000) throw new Error(`${caseId}: input.question must be 1 to 2000 characters`);
    if (typeof testCase.input.userId !== 'string' || !testCase.input.userId.trim()) throw new Error(`${caseId}: input.userId is required`);
    if (typeof testCase.expected !== 'string' || !testCase.expected.trim()) throw new Error(`${caseId}: expected is required`);
  }
  return suite;
}

export async function loadSuite(path = defaultConfigPath, env = process.env) {
  return validateSuite(resolveSuite(parse(await readFile(path, 'utf8')), env));
}

export function selectCandidates(suite, set = 'models', variantIds = VARIANT_IDS) {
  if (set === 'models') return suite.candidates.map((candidate) => ({ ...candidate, header_value: candidate.id }));
  if (set !== 'variants') throw new Error('candidate set must be models or variants');
  if (variantIds.length !== VARIANT_IDS.length || new Set(variantIds).size !== VARIANT_IDS.length ||
      variantIds.some((id) => !VARIANT_IDS.includes(id))) {
    throw new Error('variant set requires exactly three distinct shipped variant ids');
  }
  const base = suite.candidates.find((candidate) => candidate.id === suite.variant_candidate);
  return variantIds.map((id) => ({ id, name: `${id} variant on ${base.name}`, header_value: base.id, variant_id: id, model_name: base.model_name }));
}

export async function resolveCandidateVersions(candidates, read = readFile) {
  return Promise.all(candidates.map(async (candidate) => {
    if (!candidate.variant_id) return candidate;
    const raw = await read(resolve(here, `../src/variants/${candidate.variant_id}.json`));
    const parsed = JSON.parse(raw);
    if (parsed.id !== candidate.variant_id) throw new Error(`variant file id mismatch: ${candidate.variant_id}`);
    return { ...candidate, agent_version: variantVersion(candidate.variant_id, raw) };
  }));
}

export function candidateHeaders(candidate) {
  return { 'content-type': 'application/json', 'x-agent-model': candidate.header_value,
    ...(candidate.variant_id ? { 'x-agent-variant': candidate.variant_id } : {}) };
}

export function scheduledPlan(suite, { now = new Date(), random = Math.random, variantIds = VARIANT_IDS,
  candidateSet, immediate = false, existingRuns, delayMsOverride, probabilityOverride, env = process.env } = {}) {
  const delayMs = immediate ? 0 : delayMsOverride ?? Math.floor(random() * 50 * 60_000);
  const fires = immediate || random() < (probabilityOverride ?? 0.4);
  const set = candidateSet ?? (random() < 0.5 ? 'variants' : 'models');
  const candidates = selectCandidates(suite, set, variantIds);
  const at = new Date(now.getTime() + delayMs);
  const stamp = at.toISOString().slice(0, 16).replace(/[-:]/g, '');
  const day = at.toISOString().slice(0, 10).replace(/-/g, '');
  const capChecked = Array.isArray(existingRuns);
  const used = capChecked ? existingRuns.filter((id) => id.startsWith(schedPrefix(env)) && id.slice(-13, -5) === day && /-\d{8}T\d{4}$/.test(id)).length : null;
  return { delayMs, fires, set, candidates, runIds: candidates.map((candidate) => `${schedPrefix(env)}${set}-${candidate.id}-${stamp}`),
    capChecked, used, allowed: capChecked ? fires && used + candidates.length <= dailyRunCap(env) : null };
}

export function scheduledOverridesFromEnv(env = process.env) {
  const set = env.EXPERIMENTS_SET;
  const delay = env.EXPERIMENTS_DELAY_MS;
  const probability = env.EXPERIMENTS_PROBABILITY;
  if (set !== undefined && !['models', 'variants'].includes(set)) throw new Error('EXPERIMENTS_SET must be models or variants');
  if (delay !== undefined && (!/^\d+$/.test(delay) || Number(delay) > 50 * 60_000)) throw new Error('EXPERIMENTS_DELAY_MS must be 0 to 3000000');
  if (probability !== undefined && !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(probability)) throw new Error('EXPERIMENTS_PROBABILITY must be 0 to 1');
  return { ...(set === undefined ? {} : { candidateSet: set }),
    ...(delay === undefined ? {} : { delayMsOverride: Number(delay) }),
    ...(probability === undefined ? {} : { probabilityOverride: Number(probability) }) };
}

/** The suite in the SDK's portable TestSuite shape (used for the run record and for publishing). */
export function portableSuite(suite, version) {
  return { suiteId: suite.suite_id, name: suite.name, description: suite.description, tags: suite.tags, changelog: suite.changelog,
    ...(version ? { version } : {}),
    testCases: suite.cases.map((item) => ({ testCaseId: item.test_case_id, name: item.name,
      description: item.description, tags: item.tags, category: item.category, input: item.input,
      expected: { answer: { text: item.expected } } })) };
}

export function experimentPayload(suite, candidate, runId, suiteVersion) {
  return {
    run_id: runId,
    name: `${suite.name} - ${candidate.name}`,
    source: 'external',
    description: `${suite.description} Candidate: ${candidate.name}.`,
    tags: [...suite.tags, `${candidate.variant_id ? 'variant' : 'model'}-comparison`, candidate.id],
    suite_id: suite.suite_id,
    suite_version: suiteVersion,
    candidate: {
      agent_name: suite.candidate.agent_name,
      ...(candidate.agent_version ? { agent_version: candidate.agent_version } : {}),
      model_provider: suite.candidate.model_provider,
      model_name: candidate.model_name,
    },
    planned_trial_count: suite.cases.length,
    metadata: {
      online_evaluator_id: suite.online_evaluator.evaluator_id,
      ...(suite.online_evaluator.version ? { online_evaluator_version: suite.online_evaluator.version } : {}),
      model_header: candidate.header_value,
      variant_version_scope: candidate.agent_version ? 'pinned_variant' : 'mixed_rotating',
    },
  };
}

export async function evaluatorScore(client, runId, trialId, evaluatorId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await client.listScores(runId, { limit: 100, ...(cursor ? { cursor } : {}) });
      const matches = result.items.filter((item) => (item.trialId ?? item.trial_id) === trialId &&
        (item.evaluatorId ?? item.evaluator_id) === evaluatorId);
      if (matches.length) {
        const value = matches.at(-1).value;
        const number = typeof value === 'number' ? value : value?.number;
        if (!Number.isFinite(number)) throw new Error(`${runId}/${trialId}: evaluator score is not numeric`);
        return number;
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(`${runId}/${trialId}: evaluator score absent after successful evaluation`);
}

/**
 * Read-only control-plane access with the ingest token (Basic tenant:token) against
 * <AGENTO11Y_ENDPOINT>/api/v1/eval. When the stack refuses the ingest token for a read and a
 * Grafana service account token is configured, the same path is retried through the Grafana
 * plugin resources endpoint.
 */
export function controlPlane({ endpoint, tenantId, ingestToken, grafanaUrl, saToken, fetchImpl = fetch } = {}) {
  if (!endpoint?.trim() || !tenantId?.trim()) throw new Error('AGENTO11Y_ENDPOINT and AGENTO11Y_AUTH_TENANT_ID are required');
  if (!ingestToken?.trim()) throw new Error('AGENTO11Y_AUTH_TOKEN is required for control-plane reads');
  const ingestBase = `${endpoint.replace(/\/+$/, '')}/api/v1/eval`;
  const grafanaBase = grafanaUrl ? `${grafanaUrl.replace(/\/+$/, '')}/api/plugins/grafana-agento11y-app/resources/eval` : undefined;
  async function get(path, { allowMissing = false } = {}) {
    let response = await fetchImpl(`${ingestBase}${path}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${tenantId}:${ingestToken}`).toString('base64')}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    if ([401, 403].includes(response.status)) {
      if (!saToken?.trim() || !grafanaBase) throw new Error(`control-plane GET ${path.split('?')[0]} requires AGENTO11Y_GRAFANA_URL and AGENTO11Y_SERVICE_ACCOUNT_TOKEN after ingest HTTP ${response.status}`);
      response = await fetchImpl(`${grafanaBase}${path}`, {
        headers: { Authorization: `Bearer ${saToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
      });
    }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`control-plane GET ${path.split('?')[0]} returned HTTP ${response.status}`);
    return response.json();
  }
  return {
    async listRuns() {
      const items = [];
      const seen = new Set();
      let cursor;
      for (;;) {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const page = await get(`/experiments?${query}`);
        if (!Array.isArray(page?.items)) throw new Error('experiment inventory lacks items');
        items.push(...page.items);
        if (!page.next_cursor) return items;
        if (seen.has(page.next_cursor) || items.length > 10000) throw new Error('experiment inventory cannot be proved complete');
        seen.add(page.next_cursor);
        cursor = page.next_cursor;
      }
    },
    getSuite: (suiteId) => get(`/test-suites/${encodeURIComponent(suiteId)}`, { allowMissing: true }),
  };
}

function loopbackBaseURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('base URL must be an absolute loopback URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('base URL must point to localhost or a loopback address (kubectl port-forward the orchestrator)');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function runIdFor(prefix, candidate) {
  const id = `${prefix}-${candidate.id}`;
  if (id.length > 96) throw new Error('generated run ID is too long');
  return id;
}

export class PendingEvaluationError extends Error {
  constructor(runId, trialId, evaluationId, status) {
    super(`evaluation ${evaluationId} for ${runId}/${trialId} remains ${status}`);
    this.name = 'PendingEvaluationError';
    this.runId = runId;
    this.trialId = trialId;
    this.evaluationId = evaluationId;
  }
}

export function encodePendingTuple({ trialId, evaluationId, testCaseId, conversationId, traceId, spanId, inputTokens, outputTokens }) {
  return [trialId, evaluationId, testCaseId, conversationId, traceId ?? '', spanId ?? '', inputTokens, outputTokens]
    .map((value) => encodeURIComponent(String(value))).join(':');
}

export function parsePendingTuples(value) {
  try {
    return value.split(',').map((pair) => {
      const fields = pair.split(':');
      if (fields.length !== 8) throw new Error('invalid pending evaluation tuples');
      const [trialId, evaluationId, testCaseId, conversationId, traceId, spanId, input, output] = fields.map(decodeURIComponent);
      if (![trialId, evaluationId, testCaseId, conversationId].every(Boolean) || !/^\d+$/.test(input) || !/^\d+$/.test(output)) {
        throw new Error('invalid pending evaluation tuples');
      }
      return { trialId, evaluationId, testCaseId, conversationId, traceId, spanId,
        inputTokens: Number(input), outputTokens: Number(output) };
    });
  } catch {
    throw new Error('invalid pending evaluation tuples');
  }
}

export class PendingEvaluationsError extends Error {
  constructor(runId, evaluations) {
    const pending = evaluations.map(encodePendingTuple).join(',');
    super(`run ${runId} has pending evaluations; resume with --poll-evaluation-run ${runId} --poll-evaluations ${pending}`);
    this.name = 'PendingEvaluationsError';
    this.runId = runId;
    this.evaluations = evaluations;
  }
}

export class PendingRunsError extends Error {
  constructor(runs) {
    super(`experiment runs remain pending:\n${runs.map((run) => run.message).join('\n')}`);
    this.name = 'PendingRunsError';
    this.runs = runs;
  }
}

export class EvaluatorFailedError extends Error {
  constructor(runId, trialId, reason) {
    super(`${runId}/${trialId}: evaluator failed: ${reason}`);
    this.name = 'EvaluatorFailedError';
  }
}

const evaluatorMeta = (evaluator) => ({ evaluatorId: evaluator.evaluator_id, ...(evaluator.version ? { version: evaluator.version } : {}), kind: 'llm_judge' });

export async function pollEvaluation(client, runId, trialId, evaluationId, { attempts = 200, intervalMs = 3_000 } = {}) {
  let status = await client.getTrialEvaluation(runId, trialId, evaluationId);
  for (let attempt = 0; attempt < attempts && !['success', 'failed'].includes(status.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    status = await client.getTrialEvaluation(runId, trialId, evaluationId);
  }
  if (status.status === 'success') return status;
  if (status.status === 'failed') throw new EvaluatorFailedError(runId, trialId, status.error ?? '');
  throw new PendingEvaluationError(runId, trialId, evaluationId, status.status);
}

export async function resumePendingRun(client, runId, evaluations, { evaluator, evaluationPoll = {} } = {}) {
  if (!evaluator?.evaluator_id) throw new Error('pending resume requires the suite online evaluator');
  const pending = [];
  for (const original of evaluations) {
    const { trialId, evaluationId, testCaseId, conversationId } = original;
    try {
      await pollEvaluation(client, runId, trialId, evaluationId, evaluationPoll);
      if (!testCaseId) throw new Error('pending resume requires testCaseId for each evaluation');
      if (!conversationId) throw new Error('pending resume requires conversationId for each evaluation');
      const value = await evaluatorScore(client, runId, trialId, evaluator.evaluator_id);
      const trial = Trial.fromRef(client, { experimentId: runId, testCaseId, attempt: 1 });
      trial.bindConversation(conversationId);
      if (original.traceId) await trial.bindTrace(original.traceId, original.spanId ?? '');
      if (Number.isFinite(original.inputTokens) && Number.isFinite(original.outputTokens)) {
        trial.setUsage({ inputTokens: original.inputTokens, outputTokens: original.outputTokens });
      }
      await trial.start();
      trial.finalScore(value, { passed: value >= 0.8, evaluator: evaluatorMeta(evaluator) });
      await trial.close();
    } catch (error) {
      if (error instanceof PendingEvaluationError) { pending.push(original); continue; }
      if (error instanceof EvaluatorFailedError) {
        try { await client.finalize(runId, 'failed', { error: error.message }); }
        catch (finalizeError) { error.finalizationError = finalizeError.message; }
      }
      throw error;
    }
  }
  if (pending.length) throw new PendingEvaluationsError(runId, pending);
  await client.finalize(runId, 'completed');
}

/**
 * The published stored-suite version to run against. Publishes the local suite when none is
 * published, when the published case count differs, or when forced; publishing needs the
 * Grafana service account token (TestSuitesClient).
 */
export async function ensurePublishedSuite(suite, { reads, suites, force = false, log = () => {} }) {
  const detail = await reads.getSuite(suite.suite_id);
  const published = detail?.versions?.filter((version) => version.published).at(-1);
  if (published && !force && published.test_case_count === suite.cases.length) return published.version;
  if (!suites) {
    throw new Error(`test suite ${suite.suite_id} has no matching published version; set AGENTO11Y_GRAFANA_URL and AGENTO11Y_SERVICE_ACCOUNT_TOKEN so the runner can publish it`);
  }
  const pushed = await suites.pushSuite(portableSuite(suite), { publish: true, changelog: suite.changelog, prune: true });
  log({ event: 'suite_published', suiteId: suite.suite_id, suiteVersion: pushed.suiteVersion });
  return pushed.suiteVersion;
}

function defaultSuitesClient(env = process.env) {
  if (!env.AGENTO11Y_GRAFANA_URL || !env.AGENTO11Y_SERVICE_ACCOUNT_TOKEN) return undefined;
  return new TestSuitesClient({ grafanaUrl: env.AGENTO11Y_GRAFANA_URL, serviceAccountToken: env.AGENTO11Y_SERVICE_ACCOUNT_TOKEN });
}

export async function executeExperiment({ suite, baseUrl, runIdPrefix, runIdsOverride, scheduled = false, pushSuite = false,
  set = 'models', variantIds = VARIANT_IDS, fetchImpl = fetch, client, suites, reads, env = process.env,
  log = () => {}, evaluationPoll = {} }) {
  validateSuite(suite);
  if (!ID.test(runIdPrefix ?? '')) throw new Error('run ID prefix must be a short stable identifier');
  const ingest = client ?? new ExperimentsClient();
  if (!ingest.tenantId || !ingest.endpoint) throw new Error('the experiment ingest client needs AGENTO11Y_ENDPOINT and AGENTO11Y_AUTH_TENANT_ID');
  const fail = (error) => { log({ event: 'experiment_preflight_failed', reason: error.message }); return error; };
  let plane;
  try {
    plane = reads ?? controlPlane({ endpoint: ingest.endpoint, tenantId: ingest.tenantId, ingestToken: env.AGENTO11Y_AUTH_TOKEN,
      grafanaUrl: env.AGENTO11Y_GRAFANA_URL, saToken: env.AGENTO11Y_SERVICE_ACCOUNT_TOKEN, fetchImpl });
  } catch (error) { throw fail(error); }
  const candidates = await resolveCandidateVersions(selectCandidates(suite, set, variantIds));
  const orchestratorName = suite.candidate.agent_name;
  const base = scheduled ? new URL(baseUrl) : loopbackBaseURL(baseUrl);
  const liveURL = (path) => new URL(path, `${base.href.replace(/\/$/, '')}/`);
  const health = await fetchImpl(liveURL('/healthz'), { method: 'GET', signal: AbortSignal.timeout(5_000) });
  if (!health.ok) throw new Error(`orchestrator health check returned HTTP ${health.status}`);
  const healthBody = await health.json();
  if (healthBody.status !== 'ok' || healthBody.service !== orchestratorName) throw new Error(`health check did not identify ${orchestratorName}`);

  let experimentItems;
  try {
    experimentItems = await plane.listRuns();
    if (experimentItems.some((item) => !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof item.experiment_id !== 'string' || !item.experiment_id.trim())) {
      throw new Error('experiment inventory contains an invalid experiment_id');
    }
  } catch (error) { throw fail(error); }
  const runIds = runIdsOverride ?? candidates.map((candidate) => runIdFor(runIdPrefix, candidate));
  const existingRun = experimentItems.find((item) => runIds.includes(item.experiment_id));
  if (existingRun) throw new Error(`experiment ${existingRun.experiment_id} already exists; choose a new run ID prefix`);
  if (scheduled) {
    const cap = dailyRunCap(env);
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = experimentItems.filter((item) => item.experiment_id.startsWith(schedPrefix(env)) && item.experiment_id.slice(-13, -5) === day).length;
    log({ event: 'scheduled_cap_checked', day, used: count, cap, allowed: count + candidates.length <= cap });
    if (count + candidates.length > cap) throw new Error(`scheduled daily cap reached: ${count}/${cap} runs`);
  }

  let suiteVersion;
  try { suiteVersion = await ensurePublishedSuite(suite, { reads: plane, suites: suites ?? defaultSuitesClient(env), force: pushSuite, log }); }
  catch (error) { throw fail(error); }

  const evaluator = suite.online_evaluator;
  const pendingRuns = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex];
    const runId = runIds[candidateIndex];
    const run = experimentPayload(suite, candidate, runId, suiteVersion);
    let experiment;
    try {
      experiment = await Experiment.start(ingest, { experimentId: runId, name: run.name,
        description: run.description, tags: run.tags, suite: portableSuite(suite, suiteVersion),
        candidate: { agentName: run.candidate.agent_name, ...(run.candidate.agent_version ? { agentVersion: run.candidate.agent_version } : {}),
          modelProvider: run.candidate.model_provider, modelName: run.candidate.model_name },
        plannedTrialCount: suite.cases.length, metadata: run.metadata });
      log({ event: 'experiment_created', runId, candidate: candidate.id, suiteVersion });
      const pending = [];
      for (const testCase of suite.cases) {
        const trial = experiment.trial(testCase.test_case_id, { metadata: { candidate: candidate.id } });
        await trial.start();
        let recordedUsage;
        try {
          const startedAt = new Date();
          const response = await trial.runInTrialContext(() => fetchImpl(liveURL('/v1/ask'), {
            method: 'POST', headers: candidateHeaders(candidate), body: JSON.stringify(testCase.input),
            signal: AbortSignal.timeout(180_000),
          }));
          if (!response.ok) throw new Error(`${runId}/${testCase.test_case_id}: orchestrator returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
          const reply = await response.json();
          const completedAt = new Date();
          if (typeof reply.conversationId !== 'string' || !reply.conversationId.trim()) throw new Error(`${runId}/${testCase.test_case_id}: response is missing conversationId`);
          if (typeof reply.answer !== 'string' || !reply.answer.trim()) throw new Error(`${runId}/${testCase.test_case_id}: response is missing the answer`);
          if (!Array.isArray(reply.usage) || !reply.usage.length || !reply.usage.every((item) =>
            typeof item.agent === 'string' && typeof item.model === 'string' && Number.isFinite(item.inputTokens) && Number.isFinite(item.outputTokens))) {
            throw new Error(`${runId}/${testCase.test_case_id}: response usage is missing or invalid`);
          }
          const orchestrator = reply.usage.find((item) => item.agent === orchestratorName);
          if (!orchestrator) throw new Error(`${runId}/${testCase.test_case_id}: orchestrator usage is missing`);
          if (typeof reply.agentVersion !== 'string' || !reply.agentVersion.trim()) throw new Error(`${runId}/${testCase.test_case_id}: response is missing agentVersion`);
          if (candidate.agent_version && reply.agentVersion !== candidate.agent_version) {
            throw new Error(`${runId}/${testCase.test_case_id}: variant version mismatch: expected ${candidate.agent_version}, got ${reply.agentVersion}`);
          }
          trial.bindConversation(reply.conversationId);
          const traceId = reply.traceId ?? reply.trace_id;
          if (traceId) await trial.bindTrace(traceId, reply.spanId ?? reply.span_id);
          trial.recordIO({ input: testCase.input.question, output: reply.answer,
            modelProvider: 'anthropic', modelName: orchestrator.modelName ?? candidate.model_name,
            inputTokens: orchestrator.inputTokens, outputTokens: orchestrator.outputTokens,
            agentName: orchestratorName, agentVersion: reply.agentVersion });
          const inputTokens = reply.usage.reduce((sum, item) => sum + item.inputTokens, 0);
          const outputTokens = reply.usage.reduce((sum, item) => sum + item.outputTokens, 0);
          recordedUsage = { inputTokens, outputTokens };
          trial.setUsage({ inputTokens, outputTokens });
          await trial.artifact('transcript.md', { text: `# ${testCase.name}\n\nQuestion: ${testCase.input.question}\n\nAnswer: ${reply.answer}\n`, kind: 'markdown', mime: 'text/markdown' });
          const evaluation = await trial.evaluate(evaluator.evaluator_id,
            { ...(evaluator.version ? { evaluatorVersion: evaluator.version } : {}), timeoutMs: evaluationPoll.timeoutMs ?? 600_000 });
          if (evaluation.status !== 'success') throw new Error(`${runId}/${trial.trialId}: evaluator returned ${evaluation.status}`);
          const value = await evaluatorScore(ingest, runId, trial.trialId, evaluator.evaluator_id);
          trial.finalScore(value, { passed: value >= 0.8, evaluator: evaluatorMeta(evaluator),
            metadata: { startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(), usage: reply.usage } });
          await trial.close();
          log({ event: 'trial_recorded', runId, candidate: candidate.id, caseId: testCase.test_case_id,
            conversationId: reply.conversationId, score: value, traceBound: Boolean(traceId) });
        } catch (error) {
          if (error.name === 'TrialEvaluationTimeoutError' || error.name === 'PendingEvaluationError') {
            pending.push({ trialId: trial.trialId, evaluationId: error.evaluationId, testCaseId: testCase.test_case_id,
              conversationId: trial.conversationId, traceId: trial.traceId, spanId: trial.spanId,
              inputTokens: recordedUsage?.inputTokens, outputTokens: recordedUsage?.outputTokens });
            continue;
          }
          await trial.close({ error });
          throw error;
        }
      }
      if (pending.length) throw new PendingEvaluationsError(runId, pending);
      await experiment.finalize('completed');
    } catch (error) {
      if (error instanceof PendingEvaluationsError) { pendingRuns.push(error); continue; }
      if (experiment) {
        try { await experiment.finalize('failed', { error: error.message }); }
        catch (finalizeError) { log({ event: 'failed_run_finalization_error', runId, error: finalizeError.message }); }
      }
      if (pendingRuns.length) {
        error.pendingRuns = pendingRuns;
        for (const pendingRun of pendingRuns) log({ event: 'pending_run_resume', runId: pendingRun.runId, evaluations: pendingRun.evaluations, message: pendingRun.message });
      }
      throw error;
    }
  }
  if (pendingRuns.length) throw new PendingRunsError(pendingRuns);
  return { suiteId: suite.suite_id, suiteVersion, runIds, candidateCount: candidates.length, caseCount: suite.cases.length };
}

export function parseArgs(argv) {
  const options = { config: defaultConfigPath, baseUrl: 'http://127.0.0.1:18080', execute: false };
  const valued = { '--config': 'config', '--base-url': 'baseUrl', '--run-id-prefix': 'runIdPrefix', '--poll-evaluation-run': 'pollRunId', '--poll-evaluations': 'pollEvaluations', '--candidate-set': 'set', '--variant-ids': 'variantIds' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--scheduled') options.scheduled = true;
    else if (arg === '--scheduled-now') options.scheduledNow = true;
    else if (arg === '--push-suite') options.pushSuite = true;
    else if (valued[arg]) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      options[valued[arg]] = value;
      if (arg === '--base-url') options.baseUrlProvided = true;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export const helpText = `Usage: node experiments/run-experiment.mjs [options]

By default, validate the suite and print the planned runs without remote writes or model calls.
Pass --execute to publish the stored test suite if needed, create the runs, call the
orchestrator and submit scored trials. See the header of this file for the environment.

Options:
  --config PATH          Suite YAML (default: config/experiment-suite.yaml)
  --base-url URL         Orchestrator loopback port-forward (default: http://127.0.0.1:18080)
  --candidate-set SET    models or variants (default: models)
  --variant-ids IDS      Three comma-separated shipped variant ids
  --scheduled            CronJob mode: random delay, skip and set; in-cluster orchestrator URL
  --scheduled-now        With --scheduled: skip delay and probability, keep cap and suite checks
  --run-id-prefix ID     Stable prefix for the experiment IDs (required with --execute)
  --push-suite           Publish the local suite as a new stored version before running
  --poll-evaluation-run RUN_ID     Resume pending evaluations for an existing run
  --poll-evaluations TRIAL:ID:CASE:CONVERSATION:TRACE:SPAN:IN:OUT,...  Pending tuples from the prior run error
  --execute              Perform the writes and the orchestrator requests
  -h, --help             Show this help
`;

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText);
    return;
  }
  const suite = await loadSuite(options.config);
  if (options.pollRunId || options.pollEvaluations) {
    if (!options.pollRunId || !options.pollEvaluations || options.execute) throw new Error('poll mode requires --poll-evaluation-run and --poll-evaluations without --execute');
    const tuples = parsePendingTuples(options.pollEvaluations);
    await resumePendingRun(new ExperimentsClient(), options.pollRunId, tuples, { evaluator: suite.online_evaluator });
    process.stdout.write(`${JSON.stringify({ event: 'experiment_complete', runId: options.pollRunId, evaluationCount: tuples.length })}\n`);
    return;
  }
  const variantIds = options.variantIds?.split(',') ?? VARIANT_IDS;
  if (options.scheduledNow && !options.scheduled) throw new Error('--scheduled-now requires --scheduled');
  if (options.scheduled && options.runIdPrefix) throw new Error('--scheduled owns its run ID prefix');
  if (options.scheduled) {
    const overrides = scheduledOverridesFromEnv();
    const plan = scheduledPlan(suite, { variantIds, ...overrides,
      candidateSet: options.set ?? overrides.candidateSet, immediate: options.scheduledNow });
    process.stdout.write(`${JSON.stringify({ event: 'scheduled_plan', ...plan, candidates: plan.candidates.map((item) => item.id) })}\n`);
    if (!options.execute) return;
    await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
    if (!plan.fires) return;
    options.runIdsOverride = plan.runIds;
    options.set = plan.set;
    options.runIdPrefix = `${schedPrefix()}${plan.set}`;
    if (!options.baseUrlProvided) options.baseUrl = process.env.ORCHESTRATOR_BASE_URL || process.env.ORCHESTRATOR_URL || `http://${agentName('orchestrator')}:8080`;
  }
  const candidates = selectCandidates(suite, options.set ?? 'models', variantIds);
  if (!options.execute) {
    const runs = candidates.map((candidate) => options.runIdPrefix
      ? runIdFor(options.runIdPrefix, candidate)
      : `<prefix>-${candidate.id}`);
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', suiteId: suite.suite_id, evaluator: suite.online_evaluator, candidateCount: candidates.length, caseCount: suite.cases.length, modelRequests: candidates.length * suite.cases.length, runIds: runs }, null, 2)}\n`);
    return;
  }
  if (!options.runIdPrefix) throw new Error('--run-id-prefix is required with --execute');
  const execute = () => executeExperiment({ suite, baseUrl: options.baseUrl, runIdPrefix: options.runIdPrefix, runIdsOverride: options.runIdsOverride,
    scheduled: options.scheduled, pushSuite: options.pushSuite, set: options.set ?? 'models', variantIds,
    log: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`) });
  const result = options.scheduled ? await withScheduledLease(execute) : await execute();
  process.stdout.write(`${JSON.stringify({ event: 'experiment_complete', ...result }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`experiment runner failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
