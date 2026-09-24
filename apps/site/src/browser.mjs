import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { contentCapture, serviceNamespace } from './config.mjs';

// One synthetic reader session in headless Chromium against the site, run on a schedule
// (Kubernetes CronJob). The real browser loads the Faro bundle, so frontend observability gets
// page loads, web vitals and browser-to-backend traces without a human visitor.

// Start jitter so scheduled sessions do not all land on the CronJob minute. BROWSER_MAX_START_DELAY_MS=0 disables it.
// Kept at 4 minutes so the worst-case session still ends inside the Job's 600s activeDeadlineSeconds.
const MAX_START_DELAY_MS = Number(process.env.BROWSER_MAX_START_DELAY_MS ?? 4 * 60 * 1000);
const THINK_TIME_MIN_MS = 5 * 1000;
const THINK_TIME_MAX_MS = 40 * 1000;

// Every question names a fixture and asks for facts available from the odds or news tools.
export const FIXTURE_QUESTIONS = Object.freeze([
  'What are the best home, draw and away prices for Harbour City vs Northgate Rovers?',
  'What recent form and injury news matters for Harbour City vs Northgate Rovers?',
  'Which bookmaker has the best home price for Kingsbridge United vs Ashford Athletic?',
  'What recent team news could affect Kingsbridge United vs Ashford Athletic?',
  'Compare the best draw and away prices for Redvale vs Fellgate Wanderers.',
  'What recent form and injury news could affect Redvale vs Fellgate Wanderers?',
  'Which bookmaker has the best away price for Porthaven Town vs Millbrook Lions?',
  'What recent team news is available for Porthaven Town vs Millbrook Lions?',
  'Compare the best home and away prices for Stonebridge Saints vs Bramley Rangers.',
  'What recent form news could affect Stonebridge Saints vs Bramley Rangers?',
  'Which bookmaker lists the best home price for Eastcliff Stars vs Westford City?',
  'What recent injury and form news matters for Eastcliff Stars vs Westford City?',
  'What are the best home and away prices for Metro Rockets vs Summit Hawks?',
  'What recent preseason team news matters for Metro Rockets vs Summit Hawks?',
  'Which bookmaker has the best home price for Bayview Vipers vs Canyon Thunder?',
  'What recent preseason news matters for Bayview Vipers vs Canyon Thunder?',
]);

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

export function createSessionPlan(seed = randomBytes(4).readUInt32LE()) {
  const random = seededRandom(seed);
  const questionCount = 1 + Math.floor(random() * 3);
  return {
    startDelayMs: Math.floor(random() * (MAX_START_DELAY_MS + 1)),
    questions: sampleDistinct(FIXTURE_QUESTIONS, questionCount, random),
    thinkTimesMs: Array.from(
      { length: questionCount - 1 },
      () => THINK_TIME_MIN_MS + Math.floor(random() * (THINK_TIME_MAX_MS - THINK_TIME_MIN_MS + 1)),
    ),
  };
}

export async function runBrowser(plan = createSessionPlan()) {
  await sleep(plan.startDelayMs);
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SITE_URL || `http://${serviceNamespace()}-site-api:8080/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    for (let index = 0; index < plan.questions.length; index += 1) {
      if (index > 0) await sleep(plan.thinkTimesMs[index - 1]);
      await page.locator('#question').fill(plan.questions[index]);
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
    await browser.close();
  }
  if (failures.length > 0) process.exitCode = 1;
  return { ...plan, failures: failures.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runBrowser().catch((error) => {
    console.error(JSON.stringify({ level: 'error', message: error.message }));
    process.exitCode = 1;
  });
}
