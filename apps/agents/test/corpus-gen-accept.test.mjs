import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, applyReaderCandidates, reformatDevCandidates, runAccept } from '../corpus-gen/accept.mjs';
import { createReaderCorpusFixture, createDevPromptsFixture, baseCorpus } from '../corpus-gen/test-support.mjs';

async function loadFixtureValidator(modulePath) {
  const mod = await import(modulePath);
  return mod.validateReaderCorpus;
}

test('parseArgs requires exactly one positional review-file argument', () => {
  assert.throws(() => parseArgs([]), /usage:/);
  assert.throws(() => parseArgs(['a', 'b']), /usage:/);
  const args = parseArgs(['review.json', '--dry-run', '--prompts-dir', '/x']);
  assert.equal(args.reviewFile, 'review.json');
  assert.equal(args.dryRun, true);
  assert.equal(args.promptsDir, '/x');
});

test('applyReaderCandidates merges a reader-intent candidate without mutating the original corpus', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const validateReaderCorpus = await loadFixtureValidator(fixture.modulePath);
  const original = baseCorpus();
  const before = JSON.stringify(original);
  const merged = applyReaderCandidates(original, [{ kind: 'reader-intent', intentId: 'best-price', field: 'phrasings', text: 'cheapest for {home} v {away}?' }], validateReaderCorpus);
  assert.equal(JSON.stringify(original), before, 'the input corpus must not be mutated');
  const intent = merged.intents.find((item) => item.id === 'best-price');
  assert.ok(intent.phrasings.includes('cheapest for {home} v {away}?'));
});

test('applyReaderCandidates merges a reader-persona candidate (a whole new intent)', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const validateReaderCorpus = await loadFixtureValidator(fixture.modulePath);
  const merged = applyReaderCandidates(baseCorpus(), [{ kind: 'reader-persona', intent: { id: 'team-news', personas: ['casual-fan'], phrasings: ['any news on {team}?'], followups: [] } }], validateReaderCorpus);
  assert.ok(merged.intents.some((item) => item.id === 'team-news'));
});

test('applyReaderCandidates throws and writes nothing when the merge would be invalid, and never mutates the input', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const validateReaderCorpus = await loadFixtureValidator(fixture.modulePath);
  const original = baseCorpus();
  const before = JSON.stringify(original);
  assert.throws(() => applyReaderCandidates(original, [{ kind: 'reader-intent', intentId: 'best-price', field: 'phrasings', text: 'what about {venue}?' }], validateReaderCorpus), /invalid/);
  assert.equal(JSON.stringify(original), before);
});

test('applyReaderCandidates throws if an accepted reader-persona candidate collides with an existing intent id', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const validateReaderCorpus = await loadFixtureValidator(fixture.modulePath);
  assert.throws(() => applyReaderCandidates(baseCorpus(), [{ kind: 'reader-persona', intent: { id: 'best-price', personas: ['casual-fan'], phrasings: ['x'] } }], validateReaderCorpus), /already exists/);
});

test('reformatDevCandidates re-parses and re-formats each candidate, throwing on an invalid one', () => {
  const good = reformatDevCandidates([{ stem: 'a', file: 'team: trading\ntitle: T\n---\nturn\n' }]);
  assert.equal(good[0].stem, 'a');
  assert.match(good[0].file, /^team: trading/);
  assert.throws(() => reformatDevCandidates([{ stem: 'b', file: 'team: not-a-team\ntitle: T\n---\nturn\n' }]), /team must be one of/);
});

test('runAccept merges only "accepted" candidates into readers.json and writes only accepted prompt files', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const prompts = await createDevPromptsFixture();
  t.after(prompts.cleanup);

  const reviewFile = join(fixture.dir, 'review.json');
  await writeFile(reviewFile, JSON.stringify({
    kind: 'reader-intent',
    candidates: [
      { id: 'c1', kind: 'reader-intent', status: 'accepted', intentId: 'best-price', field: 'phrasings', text: 'cheapest for {home} v {away}?' },
      { id: 'c2', kind: 'reader-intent', status: 'candidate', intentId: 'best-price', field: 'phrasings', text: 'still under review, must not be merged' },
      { id: 'c3', kind: 'reader-intent', status: 'rejected', intentId: 'best-price', field: 'phrasings', text: 'was rejected, must not be merged' },
      { id: 'c4', kind: 'dev-team', status: 'accepted', stem: 'new-scenario', file: 'team: trading\ntitle: A new scenario\n---\nDo the task.\n' },
    ],
  }));

  const result = await runAccept({ reviewFile, corpusModule: fixture.modulePath, corpusFile: fixture.corpusPath, promptsDir: prompts.dir, dryRun: false });
  assert.equal(result.corpusChanged, true);
  assert.deepEqual(result.promptFiles, [join(prompts.dir, 'new-scenario.txt')]);

  const corpus = JSON.parse(await readFile(fixture.corpusPath, 'utf8'));
  const intent = corpus.intents.find((item) => item.id === 'best-price');
  assert.ok(intent.phrasings.includes('cheapest for {home} v {away}?'));
  assert.ok(!intent.phrasings.includes('still under review, must not be merged'));
  assert.ok(!intent.phrasings.includes('was rejected, must not be merged'));

  const promptText = await readFile(join(prompts.dir, 'new-scenario.txt'), 'utf8');
  assert.match(promptText, /title: A new scenario/);
});

test('runAccept refuses to overwrite an existing prompt file', async (t) => {
  const prompts = await createDevPromptsFixture({ 'taken.txt': 'team: trading\ntitle: Existing\n---\nturn\n' });
  t.after(prompts.cleanup);
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const reviewFile = join(fixture.dir, 'review.json');
  await writeFile(reviewFile, JSON.stringify({ candidates: [{ id: 'c1', kind: 'dev-team', status: 'accepted', stem: 'taken', file: 'team: trading\ntitle: New\n---\nturn\n' }] }));

  await assert.rejects(runAccept({ reviewFile, promptsDir: prompts.dir }), /refusing to overwrite/);
  const untouched = await readFile(join(prompts.dir, 'taken.txt'), 'utf8');
  assert.match(untouched, /title: Existing/);
});

test('runAccept aborts with no write when the merge would make the corpus invalid', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const reviewFile = join(fixture.dir, 'review.json');
  await writeFile(reviewFile, JSON.stringify({ candidates: [{ id: 'c1', kind: 'reader-intent', status: 'accepted', intentId: 'best-price', field: 'phrasings', text: 'bad {venue} placeholder' }] }));
  const before = await readFile(fixture.corpusPath, 'utf8');

  await assert.rejects(runAccept({ reviewFile, corpusModule: fixture.modulePath, corpusFile: fixture.corpusPath }), /invalid/);
  const after = await readFile(fixture.corpusPath, 'utf8');
  assert.equal(after, before);
});

test('runAccept --dry-run reports what it would do without writing anything', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const reviewFile = join(fixture.dir, 'review.json');
  await writeFile(reviewFile, JSON.stringify({ candidates: [{ id: 'c1', kind: 'reader-intent', status: 'accepted', intentId: 'best-price', field: 'phrasings', text: 'cheapest for {home} v {away}?' }] }));
  const before = await readFile(fixture.corpusPath, 'utf8');

  const result = await runAccept({ reviewFile, corpusModule: fixture.modulePath, corpusFile: fixture.corpusPath, dryRun: true });
  assert.equal(result.corpusChanged, true);
  const after = await readFile(fixture.corpusPath, 'utf8');
  assert.equal(after, before, 'dry-run must not write');
});

test('runAccept is a no-op when nothing is marked accepted', async (t) => {
  const fixture = await createReaderCorpusFixture();
  t.after(fixture.cleanup);
  const reviewFile = join(fixture.dir, 'review.json');
  await writeFile(reviewFile, JSON.stringify({ candidates: [{ id: 'c1', kind: 'reader-intent', status: 'candidate', intentId: 'best-price', field: 'phrasings', text: 'x' }] }));
  const warnings = [];
  const result = await runAccept({ reviewFile, corpusModule: fixture.modulePath, corpusFile: fixture.corpusPath }, { warn: (message) => warnings.push(message) });
  assert.equal(result.corpusChanged, false);
  assert.ok(warnings.some((message) => message.includes('nothing to do')));
  await assert.doesNotReject(access(fixture.corpusPath));
});
