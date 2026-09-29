// Synthetic reader traffic against the site API (which calls the orchestrator), so every
// dashboard has data without anyone clicking. Arrivals are jittered (exponential gaps, occasional
// bursts, some multi-turn conversations, some synthetic ratings), scaled by a configurable daily
// curve with kick-off peaks, and spend is capped per UTC day regardless of the curve.
//
// Questions, reader ids, follow-ups and ratings come from the committed corpus
// (apps/corpus/readers.json via readers.mjs), not from a handful of fixed templates: see
// pickQuestion/pickFollowup below.
//
// Settings are re-read on every tick, so a ConfigMap edit retunes a running pod. Each comes from
// the JSON settings file (LOADGEN_SETTINGS_FILE, default /etc/<namespace>-loadgen/rate.json) when
// it has the key, otherwise from the environment:
//   requestsPerMinute                LOADGEN_REQUESTS_PER_MINUTE                 mean conversation starts per minute at multiplier 1 (default 2; 0 idles)
//   dailyBudgetUsd                   LOADGEN_DAILY_BUDGET_USD                    estimated Bedrock spend per UTC day (default 15, max 30)
//   enabled                          LOADGEN_ENABLED                             master switch (default true)
//   dailyCurve                       LOADGEN_DAILY_CURVE                        24 non-negative multipliers, index = UTC hour-of-day (default DEFAULT_DAILY_CURVE); requestsPerMinute stays the mean, the curve is renormalised by its own average
//   kickoffPeaksEnabled              LOADGEN_KICKOFF_PEAKS_ENABLED               extra peaks around fixture kick-off hour/weekday, recurring weekly (default true)
//   injectionBurstMeanIntervalHours  LOADGEN_INJECTION_BURST_MEAN_INTERVAL_HOURS mean hours between prompt-injection probe bursts (default 4)
//   injectionBurstMaxSize            LOADGEN_INJECTION_BURST_MAX_SIZE            max probe conversations in one burst, from one reader (default 3, max MAX_INJECTION_BURST_SIZE)
// Target: SITE_URL (the site base URL; /api/picks is appended when it has no path).
// The spend ledger lives in LOADGEN_STATE_DIR (default /var/lib/loadgen) so a restart keeps it.
import { readFile, open, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { listFixtures } from '@touchline/mcp-tools/tools';
import { loadReaderCorpus, renderPhrasing } from '../../corpus/readers.mjs';
import { boolEnv, serviceNamespace } from './config.mjs';

export const MAX_DAILY_BUDGET_USD = 30;
export const MAX_INJECTION_BURST_SIZE = 8;
const FIXTURES = listFixtures().fixtures;
const CORPUS = loadReaderCorpus();
const PERSONAS = CORPUS.personas;
const INTENTS = CORPUS.intents;
const INJECTION_INTENTS = INTENTS.filter((intent) => CORPUS.injection.intents.includes(intent.id));
const MARKERS = CORPUS.injection.markers;
const ALL_READER_IDS = PERSONAS.flatMap((persona) => persona.readers);
// A daily shape with quiet small hours, a lunchtime bump and an evening peak (UTC). Only the
// relative shape matters: it is renormalised by its own average at read time, so
// requestsPerMinute always stays the true daily mean regardless of what shape is configured.
export const DEFAULT_DAILY_CURVE = [
  0.2, 0.15, 0.12, 0.1, 0.12, 0.2, 0.4, 0.7, 0.9, 1.0, 1.0, 1.0,
  1.05, 1.05, 1.0, 1.0, 1.05, 1.3, 1.6, 1.7, 1.5, 1.1, 0.6, 0.3,
];

const draw = (values, random) => values[Math.floor(random() * values.length)];
const weightedDraw = (items, weightOf, random) => {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let cursor = random() * total;
  for (const item of items) { cursor -= weightOf(item); if (cursor <= 0) return item; }
  return items[items.length - 1];
};
const intentsForPersona = (personaId) => INTENTS.filter((intent) => intent.personas.includes(personaId));

/** Picks a persona (weighted), a stable reader id from it, an intent it asks and a fixture, and
 * renders one phrasing for that intent/fixture. */
export function pickQuestion(random = Math.random) {
  const persona = weightedDraw(PERSONAS, (p) => p.weight, random);
  const readerId = draw(persona.readers, random);
  const intent = draw(intentsForPersona(persona.id), random);
  const fixture = draw(FIXTURES, random);
  const question = renderPhrasing(draw(intent.phrasings, random), fixture, random);
  return { persona, readerId, intent, fixture, question };
}
/** pickQuestion, redrawn (a few times at most) while its text is in `recent`, so a viewer never
 * sees two conversations open with the same words within the window `recent` covers. */
export const RECENT_QUESTION_WINDOW = 400;
export function pickFreshQuestion(recent, random = Math.random, pick = pickQuestion) {
  let picked = pick(random);
  for (let attempt = 0; attempt < 12 && recent.has(picked.question); attempt++) picked = pick(random);
  return picked;
}
function remember(recent, question) {
  recent.delete(question);
  recent.add(question);
  if (recent.size > RECENT_QUESTION_WINDOW) recent.delete(recent.values().next().value);
}
/** Renders one follow-up phrasing for `intent`, as a reply to the answer just given. */
export function pickFollowup(intent, fixture, random = Math.random) {
  return renderPhrasing(draw(intent.followups, random), fixture, random);
}
/** A phrasing from an injection-routed intent plus a guard marker, as a single probe question. */
export function pickInjectionQuestion(random = Math.random) {
  const intent = draw(INJECTION_INTENTS, random);
  const fixture = draw(FIXTURES, random);
  return `${renderPhrasing(draw(intent.phrasings, random), fixture, random)} ${draw(MARKERS, random)}`;
}

// USD per million tokens, Bedrock on-demand list price plus 10% for cross-region profiles. Only
// used to pace the daily budget, never billed. Unknown models are priced as Sonnet (conservative).
export const PRICES = { haiku: { input: 1.10, output: 5.50 }, sonnet: { input: 3.30, output: 16.50 }, opus: { input: 5.50, output: 27.50 } };
export function priceFor(model) {
  const family = Object.keys(PRICES).find((name) => String(model ?? '').toLowerCase().includes(name));
  return PRICES[family ?? 'sonnet'];
}
export function priceUsage(usage) {
  if (!Array.isArray(usage)) throw new Error('invalid usage');
  return usage.reduce((cost, row) => {
    if (!row || !Number.isFinite(row.inputTokens) || !Number.isFinite(row.outputTokens) || row.inputTokens < 0 || row.outputTokens < 0) throw new Error('invalid usage');
    const price = priceFor(row.modelName ?? row.model);
    return cost + (row.inputTokens * price.input + row.outputTokens * price.output) / 1_000_000;
  }, 0);
}
export function exponentialGap(meanSeconds, random = Math.random) {
  return Math.max(Math.max(1, meanSeconds * 0.2), Math.min(meanSeconds * 4, -Math.log(1 - Math.min(random(), 0.999999999)) * meanSeconds));
}
export function burstPlan(random = Math.random) {
  return random() < 0.1 ? Array.from({ length: 1 + Math.floor(random() * 3) }, () => 5 + Math.floor(random() * 36)) : [];
}
/** Exponential gap, in seconds, between prompt-injection probe bursts. */
export function injectionBurstGapSeconds(meanIntervalHours, random = Math.random) {
  return -Math.log(1 - Math.min(random(), 0.999999999)) * meanIntervalHours * 3600;
}
/** How many probe conversations one burst sends, 1..maxSize. */
export function injectionBurstSize(maxSize, random = Math.random) {
  return 1 + Math.floor(random() * maxSize);
}

/**
 * Weekday (UTC, 0=Sunday) and hour-of-day (UTC) each fixture kicks off at, so a peak recurs every
 * week at that slot regardless of which week's fixture date has actually passed.
 */
export function kickoffSlots(fixtures = FIXTURES) {
  return fixtures.map(({ kickoff }) => { const d = new Date(kickoff); return { weekday: d.getUTCDay(), hour: d.getUTCHours() }; });
}
function kickoffMultiplier(now, slots) {
  const weekday = now.getUTCDay();
  const hour = now.getUTCHours();
  let multiplier = 1;
  for (const slot of slots) {
    if (slot.weekday !== weekday) continue;
    const distance = Math.min(Math.abs(hour - slot.hour), 24 - Math.abs(hour - slot.hour));
    if (distance === 0) multiplier = Math.max(multiplier, 2.5);
    else if (distance === 1) multiplier = Math.max(multiplier, 1.6);
  }
  return multiplier;
}
/**
 * The arrival-rate multiplier for `now`: the configured daily curve at that UTC hour (renormalised
 * by its own average, so requestsPerMinute stays the mean), times a recurring kick-off peak when
 * settings.kickoffPeaksEnabled.
 */
export function rateMultiplier(now, settings, fixtures = FIXTURES) {
  const curve = settings.dailyCurve;
  const mean = curve.reduce((sum, value) => sum + value, 0) / curve.length;
  let multiplier = mean > 0 ? curve[now.getUTCHours()] / mean : 1;
  if (settings.kickoffPeaksEnabled) multiplier *= kickoffMultiplier(now, kickoffSlots(fixtures));
  return multiplier;
}

export function settingsFile(env = process.env) {
  return env.LOADGEN_SETTINGS_FILE || `/etc/${serviceNamespace(env)}-loadgen/rate.json`;
}
export async function readSettings(file = settingsFile(), env = process.env) {
  let fromFile = {};
  if (file) {
    try { fromFile = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`invalid loadgen settings file: ${error.message}`); }
    if (!fromFile || typeof fromFile !== 'object' || Array.isArray(fromFile)) throw new Error('invalid loadgen settings file: expected a JSON object');
  }
  const value = (key, envName, fallback) => fromFile[key] ?? env[envName] ?? fallback;
  const requestsPerMinute = Number(value('requestsPerMinute', 'LOADGEN_REQUESTS_PER_MINUTE', '2'));
  const requestedBudget = Number(value('dailyBudgetUsd', 'LOADGEN_DAILY_BUDGET_USD', '15'));
  const enabled = boolEnv(String(value('enabled', 'LOADGEN_ENABLED', 'true')), true);
  const kickoffPeaksEnabled = boolEnv(String(value('kickoffPeaksEnabled', 'LOADGEN_KICKOFF_PEAKS_ENABLED', 'true')), true);
  const requestedCurve = value('dailyCurve', 'LOADGEN_DAILY_CURVE', DEFAULT_DAILY_CURVE);
  let dailyCurve = requestedCurve;
  if (typeof requestedCurve === 'string') { try { dailyCurve = JSON.parse(requestedCurve); } catch { throw new Error('invalid loadgen settings: dailyCurve must be JSON'); } }
  const requestedInjectionInterval = Number(value('injectionBurstMeanIntervalHours', 'LOADGEN_INJECTION_BURST_MEAN_INTERVAL_HOURS', '4'));
  const requestedInjectionSize = Number(value('injectionBurstMaxSize', 'LOADGEN_INJECTION_BURST_MAX_SIZE', '3'));
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute < 0 || requestsPerMinute > 60 || !Number.isFinite(requestedBudget) || requestedBudget < 0) throw new Error('invalid loadgen settings');
  if (!Array.isArray(dailyCurve) || dailyCurve.length !== 24 || dailyCurve.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('invalid loadgen settings: dailyCurve must be 24 non-negative numbers');
  if (!Number.isFinite(requestedInjectionInterval) || requestedInjectionInterval <= 0) throw new Error('invalid loadgen settings: injectionBurstMeanIntervalHours must be > 0');
  if (!Number.isInteger(requestedInjectionSize) || requestedInjectionSize < 1) throw new Error('invalid loadgen settings: injectionBurstMaxSize must be an integer >= 1');
  return {
    requestsPerMinute,
    intervalSeconds: requestsPerMinute > 0 ? 60 / requestsPerMinute : Infinity,
    dailyBudgetUsd: Math.min(requestedBudget, MAX_DAILY_BUDGET_USD),
    enabled: enabled && requestsPerMinute > 0,
    dailyCurve,
    kickoffPeaksEnabled,
    injectionBurstMeanIntervalHours: requestedInjectionInterval,
    injectionBurstMaxSize: Math.min(requestedInjectionSize, MAX_INJECTION_BURST_SIZE),
  };
}
/** The site's picks endpoint: SITE_API_URL verbatim, else SITE_URL with /api/picks when it has no path. */
export function picksUrl(env = process.env) {
  if (env.SITE_API_URL) return env.SITE_API_URL;
  const url = new URL(env.SITE_URL || `http://${serviceNamespace(env)}-site-api:8080`);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/api/picks';
  return url.href;
}
async function readState(stateDir, today) {
  let stored;
  try { stored = JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { day: today, spent: 0, index: 0 }; throw error; }
  if (typeof stored.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stored.day) || !Number.isFinite(stored.spent) || stored.spent < 0 || !Number.isSafeInteger(stored.index) || stored.index < 0) throw new Error('invalid loadgen spend state');
  if (stored.day > today) throw new Error('loadgen spend state is in the future');
  return stored.day === today ? stored : { day: today, spent: 0, index: stored.index };
}
async function writeState(stateDir, state) {
  // Write-then-rename plus fsync so a crash never leaves a torn ledger that resets the budget.
  const temporary = join(stateDir, `.state-${randomUUID()}.json`);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(state)}\n`); await file.sync(); } finally { await file.close(); }
  await rename(temporary, join(stateDir, 'state.json'));
  const directory = await open(stateDir, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export function createLoadgen({ file = settingsFile(), stateDir = process.env.LOADGEN_STATE_DIR ?? '/var/lib/loadgen', siteUrl = picksUrl(), preflight = defaultPreflight, post = defaultPost, now = () => new Date(), random = Math.random, wait = (ms, signal) => sleep(ms, undefined, { signal }).catch(() => {}), rate, env = process.env, log = (value) => console.log(JSON.stringify(value)) } = {}) {
  const source = `${serviceNamespace(env)}-loadgen`;
  const recentQuestions = new Set();
  async function tick(session) {
    const settings = await readSettings(file, env);
    const today = now().toISOString().slice(0, 10);
    const state = await readState(stateDir, today);
    if (!settings.enabled || state.spent >= settings.dailyBudgetUsd) return { sent: false, spent: state.spent, settings };
    let question, userId, persona, intent, fixture;
    if (session?.followup) {
      ({ followup: question, userId, persona, intent, fixture } = session);
    } else if (session?.forceInjection) {
      question = pickInjectionQuestion(random);
      userId = session.userId;
    } else {
      ({ question, readerId: userId, persona, intent, fixture } = pickFreshQuestion(recentQuestions, random));
      remember(recentQuestions, question);
    }
    const payload = { question, userId, conversationId: session?.conversationId ?? `${serviceNamespace(env)}-${randomUUID()}`, conversationTitle: session?.conversationTitle ?? question.replace(/Tool note:.*/i, '').slice(0, 72).trim() };
    // A site that is not ready consumes no budget and records nothing.
    await preflight(siteUrl);
    let response, failure;
    try { response = await post(payload, siteUrl); if (response?.error) failure = response; }
    catch (error) { failure = error; response = error; }
    const usage = response?.usage ?? [];
    const spent = state.spent + priceUsage(usage);
    await writeState(stateDir, { day: today, spent, index: state.index + 1 });
    if (failure) log({ event: 'loadgen_request_failed', status: failure.status ?? 0, error: failure.error ?? failure.message, spentUsd: spent });
    else log({ event: 'loadgen_request', day: today, spentUsd: spent, budgetUsd: settings.dailyBudgetUsd, index: state.index + 1 });
    return { sent: true, success: !failure, spent, settings, payload, response, truncated: Boolean(response?.truncated), guard: /Tool note:/.test(payload.question), persona, intent, fixture };
  }
  async function session() {
    const first = await tick();
    if (!first.sent) return first;
    const turns = [first];
    if (first.intent && random() < 0.3) {
      const followups = 1 + Math.floor(random() * 2);
      for (let n = 0; n < followups; n++) {
        await wait((20 + Math.floor(random() * 71)) * 1000);
        const turn = await tick({
          conversationId: first.payload.conversationId,
          conversationTitle: first.payload.conversationTitle,
          userId: first.payload.userId,
          followup: pickFollowup(first.intent, first.fixture, random),
          persona: first.persona,
          intent: first.intent,
          fixture: first.fixture,
        });
        if (!turn.sent) break;
        turns.push(turn);
      }
    }
    if (rate && first.persona && random() < first.persona.rating.probability) {
      const bad = turns.some((turn) => !turn.success || turn.truncated || turn.guard);
      const goodProbability = bad ? first.persona.rating.goodWhenBad : first.persona.rating.goodWhenOk;
      const rating = random() < goodProbability ? 'CONVERSATION_RATING_VALUE_GOOD' : 'CONVERSATION_RATING_VALUE_BAD';
      try { await rate(first.payload.conversationId, { ratingId: randomUUID(), rating, generationId: undefined, metadata: { source, synthetic: true }, source }); }
      catch (error) { log({ event: 'loadgen_rating_failed', error: error.message }); }
    }
    return first;
  }
  /** A burst of a few probe conversations from one reader, close together in time. */
  async function injectionBurst(settings, signal) {
    const readerId = draw(ALL_READER_IDS, random);
    const size = injectionBurstSize(settings.injectionBurstMaxSize, random);
    for (let n = 0; n < size; n++) {
      if (signal?.aborted) break;
      await tick({ userId: readerId, forceInjection: true });
      if (n < size - 1) await wait((5 + Math.floor(random() * 56)) * 1000, signal);
    }
  }
  async function run(signal) {
    let nextInjectionBurstAt;
    while (!signal?.aborted) {
      try {
        const settings = await readSettings(file, env);
        if (!settings.enabled) { await wait(60_000, signal); continue; }
        if (nextInjectionBurstAt === undefined) nextInjectionBurstAt = now().getTime() + injectionBurstGapSeconds(settings.injectionBurstMeanIntervalHours, random) * 1000;
        const multiplier = rateMultiplier(now(), settings);
        // A curve hour set to 0 is a quiet hour: re-check each minute instead of waiting forever.
        if (!(multiplier > 0)) { await wait(60_000, signal); continue; }
        await wait(exponentialGap(settings.intervalSeconds / multiplier, random) * 1000, signal);
        if (signal?.aborted) break;
        if (now().getTime() >= nextInjectionBurstAt) {
          await injectionBurst(settings, signal);
          nextInjectionBurstAt = now().getTime() + injectionBurstGapSeconds(settings.injectionBurstMeanIntervalHours, random) * 1000;
          continue;
        }
        await session();
        for (const gap of burstPlan(random)) { await wait(gap * 1000, signal); if (signal?.aborted) break; await session(); }
      } catch (error) { log({ event: 'loadgen_error', error: error.message }); await wait(60_000, signal); }
    }
  }
  return { tick, session, run };
}
async function defaultPost(payload, siteUrl) {
  const response = await fetch(siteUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  return response.ok ? body : { ...body, error: body.error ?? `site API returned ${response.status}`, status: response.status };
}
async function defaultPreflight(siteUrl) {
  const response = await fetch(new URL('/healthz', siteUrl), { method: 'GET', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`site readiness returned ${response.status}`);
}

export async function runLoadgenMain() {
  const { startTelemetry } = await import('./telemetry.mjs');
  const { createAgentClient } = await import('./agent-client.mjs');
  const telemetry = startTelemetry('loadgen');
  const client = createAgentClient('loadgen', telemetry);
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  try { await createLoadgen({ rate: (id, input) => client.submitConversationRating(id, input) }).run(controller.signal); }
  finally { await client.shutdown(); await telemetry.shutdown(); }
}
