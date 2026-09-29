import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runGrow, KINDS, MAX_COUNT } from '../corpus-gen/grow.mjs';
import { createReaderCorpusFixture, createDevPromptsFixture, fakeAgentClient, fakeTelemetry } from '../corpus-gen/test-support.mjs';

const FAKE_MODEL_ENV = { CORPUS_GEN_MODEL_ID: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', AWS_REGION: 'eu-west-1' };

test('parseArgs applies defaults and validates --kind, --name and --count', () => {
  const args = parseArgs(['--kind', 'reader-intent', '--name', 'best-price']);
  assert.equal(args.count, 10);
  assert.equal(args.maxUsd, 0.5);
  assert.equal(args.dryRun, false);
  assert.throws(() => parseArgs(['--kind', 'not-a-kind', '--name', 'x']), /--kind must be one of/);
  assert.ok(KINDS.includes('reader-intent'));
  assert.throws(() => parseArgs(['--kind', 'reader-intent']), /--name is required/);
  assert.throws(() => parseArgs(['--kind', 'reader-intent', '--name', 'x', '--count', String(MAX_COUNT + 1)]), /--count must be/);
  assert.throws(() => parseArgs(['--kind', 'reader-intent', '--name', 'x', '--count', '0']), /--count must be/);
});

test('parseArgs sets --dry-run and passes through path overrides', () => {
  const args = parseArgs(['--kind', 'dev-team', '--name', 'trading', '--dry-run', '--prompts-dir', '/tmp/fixture-prompts']);
  assert.equal(args.dryRun, true);
  assert.equal(args.promptsDir, '/tmp/fixture-prompts');
});

test('runGrow --dry-run prints the prompt and never calls the model', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const logged = [];
  let modelCalled = false;
  const args = { kind: 'reader-intent', name: 'best-price', count: 5, maxUsd: 0.5, dryRun: true, corpusModule: fixture.modulePath };
  const result = await runGrow(args, { log: (line) => logged.push(line), callModel: async () => { modelCalled = true; } });
  assert.equal(result.dryRun, true);
  assert.equal(modelCalled, false);
  assert.ok(logged.some((line) => line.includes('--- system ---') && line.includes('--- user ---')));
  assert.ok(logged[0].includes('best-price'));
});

test('runGrow (reader-intent) accepts a new phrasing, rejects an in-batch duplicate, and writes the review file', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const outDir = await mkdtemp(join(tmpdir(), 'corpus-gen-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const outPath = join(outDir, 'review.json');

  const raw = [
    { field: 'phrasings', text: 'cheapest odds for {home} against {away}?' },
    { field: 'phrasings', text: 'cheapest odds for {home} against {away}?' }, // exact duplicate within the batch
  ];
  const args = { kind: 'reader-intent', name: 'best-price', count: 1, maxUsd: 0.5, out: outPath, corpusModule: fixture.modulePath };
  const result = await runGrow(args, {
    env: FAKE_MODEL_ENV,
    telemetry: fakeTelemetry(),
    client: fakeAgentClient(),
    callModel: async () => ({ text: JSON.stringify(raw), stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 40 } }),
  });

  assert.equal(result.review.summary.accepted, 1);
  assert.equal(result.review.summary.rejected, 1);
  assert.ok(result.review.spend.spentUsd > 0);
  assert.equal(result.review.spend.calls.length, 1);

  const onDisk = JSON.parse(await readFile(outPath, 'utf8'));
  assert.deepEqual(onDisk, result.review);
  const accepted = onDisk.candidates.filter((candidate) => candidate.status === 'candidate');
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].text, 'cheapest odds for {home} against {away}?');
});

test('runGrow refuses to start a call whose worst case would exceed --max-usd', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const outDir = await mkdtemp(join(tmpdir(), 'corpus-gen-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const outPath = join(outDir, 'review.json');

  let modelCalled = false;
  const warnings = [];
  const args = { kind: 'reader-intent', name: 'best-price', count: 10, maxUsd: 0.00001, out: outPath, corpusModule: fixture.modulePath };
  const result = await runGrow(args, {
    env: FAKE_MODEL_ENV,
    telemetry: fakeTelemetry(),
    client: fakeAgentClient(),
    warn: (message) => warnings.push(message),
    callModel: async () => { modelCalled = true; return { text: '[]', usage: { inputTokens: 1, outputTokens: 1 } }; },
  });

  assert.equal(modelCalled, false);
  assert.equal(result.review.spend.stoppedForBudget, true);
  assert.equal(result.review.spend.spentUsd, 0);
  assert.equal(result.review.spend.calls.length, 0);
  assert.equal(result.review.summary.accepted, 0);
  assert.ok(warnings.some((message) => message.includes('stopping before attempt')));
});

test('runGrow (dev-team) accepts a new prompt file candidate grounded in the team\'s existing prompts', async (t) => {
  const prompts = await createDevPromptsFixture({
    '21-best-price-table.txt': 'team: trading\ntitle: Best price table for a fixture\n---\nBuild a best-price table.\n',
  });
  t.after(prompts.cleanup);
  const outDir = await mkdtemp(join(tmpdir(), 'corpus-gen-out-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const outPath = join(outDir, 'review.json');

  const raw = [{ title: 'Summarise the injury news feed', effort: 'low', turns: ['Write a one-paragraph summary of the injury news feed for the newsroom.'] }];
  const args = { kind: 'dev-team', name: 'trading', count: 1, maxUsd: 0.5, out: outPath, promptsDir: prompts.dir };
  const result = await runGrow(args, {
    env: FAKE_MODEL_ENV,
    telemetry: fakeTelemetry(),
    client: fakeAgentClient(),
    callModel: async () => ({ text: JSON.stringify(raw), usage: { inputTokens: 200, outputTokens: 80 } }),
  });

  assert.equal(result.review.summary.accepted, 1);
  const [candidate] = result.review.candidates.filter((item) => item.status === 'candidate');
  assert.equal(candidate.parsed.team, 'trading');
  assert.match(candidate.file, /^team: trading/);
});
