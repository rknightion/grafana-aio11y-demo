import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { chromium } from 'playwright';
import { loadReaderCorpus, renderPhrasing } from '../../corpus/readers.mjs';
import { firstFresh, questionClaimer } from '../../corpus/recent.mjs';
import { contentCapture, serviceNamespace } from './config.mjs';

// One synthetic reader session in headless Chromium against the site, run on a schedule
// (Kubernetes CronJob). The real browser loads the Faro bundle, so frontend observability gets
// page loads, web vitals and browser-to-backend traces without a human visitor.

// Start jitter so scheduled sessions do not all land on the CronJob minute. BROWSER_MAX_START_DELAY_MS=0 disables it.
// Kept at 4 minutes so the worst-case session still ends inside the Job's 600s activeDeadlineSeconds.
const MAX_START_DELAY_MS = Number(process.env.BROWSER_MAX_START_DELAY_MS ?? 4 * 60 * 1000);
const THINK_TIME_MIN_MS = 5 * 1000;
const THINK_TIME_MAX_MS = 40 * 1000;
// Replacement questions a run can fall back to when a planned one was asked recently (by any
// site-browser run or the load generator; see apps/corpus/recent.mjs).
const SPARE_QUESTIONS = 12;

const CORPUS = loadReaderCorpus();
const FIXTURES = JSON.parse(readFileSync(new URL('../../mcp-tools/src/data/fixtures.json', import.meta.url), 'utf8'));
// Every phrasing that names the home side ({home}, or {team} resolved to home) of every
// non-injection intent, rendered for every fixture, so every entry names its fixture and a seeded
// plan rarely repeats a first question the load generator just asked. Drawn from the same corpus the
// in-app load generator uses (apps/corpus/readers.json), not a hand-maintained list.
export const FIXTURE_QUESTIONS = Object.freeze([...new Set(
  CORPUS.intents
    .filter((intent) => !CORPUS.injection.intents.includes(intent.id))
    .flatMap((intent) => intent.phrasings.filter((phrasing) => /\{(home|team)\}/.test(phrasing)))
    .flatMap((phrasing) => FIXTURES.map((fixture) => renderPhrasing(phrasing, fixture, () => 0))),
)]);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    let value = state += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function sampleDistinct(items, count, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

function splitPlanned(sampled, count) {
  return { questions: sampled.slice(0, count), spares: sampled.slice(count) };
}

// The shared recent-question store, when the chart provides one (REDIS_URL).
function defaultClaimer() {
  if (!process.env.REDIS_URL) return { claim: questionClaimer(null), close() {} };
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 2000 });
  redis.on('error', () => {});
  return { claim: questionClaimer(redis), close: () => redis.disconnect() };
}

export function createSessionPlan(seed = randomBytes(4).readUInt32LE()) {
  const random = seededRandom(seed);
  const questionCount = 1 + Math.floor(random() * 3);
  return {
    startDelayMs: Math.floor(random() * (MAX_START_DELAY_MS + 1)),
    ...splitPlanned(sampleDistinct(FIXTURE_QUESTIONS, questionCount + SPARE_QUESTIONS, random), questionCount),
    thinkTimesMs: Array.from(
      { length: questionCount - 1 },
      () => THINK_TIME_MIN_MS + Math.floor(random() * (THINK_TIME_MAX_MS - THINK_TIME_MIN_MS + 1)),
    ),
  };
}

/** The planned question for `index`, or the first spare not yet asked in this run, whichever
 * claim() reports nobody asked recently; null when every candidate was. */
export function nextQuestion(plan, index, asked, claim) {
  const candidates = [plan.questions[index], ...plan.spares].filter((question) => !asked.includes(question));
  return firstFresh(candidates, claim);
}

export async function runBrowser(plan = createSessionPlan(), { claimer: injected } = {}) {
  await sleep(plan.startDelayMs);
  const claimer = injected ?? defaultClaimer();
  const failures = [];
  const asked = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(process.env.SITE_URL || `http://${serviceNamespace()}-site-api:8080/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    for (let index = 0; index < plan.questions.length; index += 1) {
      if (index > 0) await sleep(plan.thinkTimesMs[index - 1]);
      const question = await nextQuestion(plan, index, asked, claimer.claim);
      if (!question) {
        console.log(JSON.stringify({ event: 'browser-skip', index, reason: 'every candidate asked recently' }));
        continue;
      }
      asked.push(question);
      await page.locator('#question').fill(question);
      await page.locator('#picks-form button').click();
      await page.waitForFunction(() => {
        const value = document.querySelector('#result')?.textContent || '';
        return value !== '' && value !== 'Loading…';
      }, null, { timeout: 45000 });
      const result = await page.locator('#result').textContent();
      // With content capture off, log only the size of the answer, never its text.
      console.log(JSON.stringify({ event: 'browser-picks', index, ...(contentCapture() ? { result: result.slice(0, 1000) } : { resultLength: result.length }) }));
      if (result.includes('"error"') || result.startsWith('Request failed:')) failures.push(result);
    }
  } finally {
    await browser?.close();
    claimer.close();
  }
  if (failures.length > 0) process.exitCode = 1;
  return { ...plan, asked, failures: failures.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBrowser().catch((error) => {
    console.error(JSON.stringify({ level: 'error', message: error.message }));
    process.exitCode = 1;
  });
}
