// Shared test fixtures for the corpus-gen test suite (apps/agents/test/corpus-gen-*.test.mjs).
// Not a *.test.mjs file on purpose: node --test's default discovery also picks up any file inside
// a directory literally named "test", so a helper module must stay out of that directory.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A minimal but faithful stand-in for the real apps/corpus/readers.mjs (Seam 1, AIO-0001
// seams.md): same three exports, same validation rules (unique ids, persona references resolve,
// only {home}/{away}/{team} placeholders). Lane A's real module may differ in exact wording but
// must honour the same contract.
export const FIXTURE_READERS_MJS = `
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const READER_CORPUS_FILE = fileURLToPath(new URL('./readers.json', import.meta.url));
const ALLOWED_PLACEHOLDERS = ['{home}', '{away}', '{team}'];
export function validateReaderCorpus(corpus) {
  const errors = [];
  if (typeof corpus?.version !== 'number') errors.push('version must be a number');
  const personaIds = new Set();
  for (const persona of corpus.personas ?? []) {
    if (personaIds.has(persona.id)) errors.push(\`duplicate persona id: \${persona.id}\`);
    personaIds.add(persona.id);
  }
  const intentIds = new Set();
  for (const intent of corpus.intents ?? []) {
    if (intentIds.has(intent.id)) errors.push(\`duplicate intent id: \${intent.id}\`);
    intentIds.add(intent.id);
    for (const personaId of intent.personas ?? []) if (!personaIds.has(personaId)) errors.push(\`intent \${intent.id} references unknown persona \${personaId}\`);
    for (const text of [...(intent.phrasings ?? []), ...(intent.followups ?? [])]) {
      for (const placeholder of text.match(/\\{[a-zA-Z]+\\}/g) ?? []) {
        if (!ALLOWED_PLACEHOLDERS.includes(placeholder)) errors.push(\`intent \${intent.id} uses a disallowed placeholder \${placeholder}\`);
      }
    }
  }
  return errors;
}
export async function loadReaderCorpus(file = READER_CORPUS_FILE) {
  const corpus = JSON.parse(await readFile(file, 'utf8'));
  const errors = validateReaderCorpus(corpus);
  if (errors.length) throw new Error(errors.join('; '));
  return corpus;
}
`;

export function baseCorpus() {
  return {
    version: 1,
    personas: [
      { id: 'casual-fan', description: 'watches occasionally', weight: 4, readers: ['fan-jamie'], rating: { probability: 0.15, goodWhenOk: 0.8, goodWhenBad: 0.1 } },
    ],
    intents: [
      { id: 'best-price', personas: ['casual-fan'], phrasings: ['best price {home} v {away}?'], followups: ['and the draw?'] },
    ],
    injection: { intents: [], markers: [] },
  };
}

/** Writes a fixture readers.mjs + readers.json into a fresh temp dir. Caller must await cleanup(). */
export async function createReaderCorpusFixture(corpus = baseCorpus()) {
  const dir = await mkdtemp(join(tmpdir(), 'corpus-gen-fixture-'));
  const modulePath = join(dir, 'readers.mjs');
  const corpusPath = join(dir, 'readers.json');
  await writeFile(modulePath, FIXTURE_READERS_MJS, 'utf8');
  await writeFile(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
  return { dir, modulePath, corpusPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Writes fixture agent-host/prompts/*.txt files into a fresh temp dir. Caller must await cleanup(). */
export async function createDevPromptsFixture(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'corpus-gen-prompts-'));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content, 'utf8');
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A minimal fake agento11y client: records nothing, never touches the network. */
export function fakeAgentClient() {
  return { startGeneration: async (_start, callback) => callback({ setResult() {} }), shutdown: async () => {} };
}
export function fakeTelemetry() {
  return { tracer: {}, meter: {}, async shutdown() {} };
}
