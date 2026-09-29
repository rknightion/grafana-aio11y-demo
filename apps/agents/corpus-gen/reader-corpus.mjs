// Loads Seam 1 (apps/corpus/readers.mjs + readers.json, frozen, see AIO-0001 seams.md) as few-shot
// context and as the validator for reader-persona / reader-intent candidates. Tolerant of the
// module not existing yet (lane A is mid-build); pass --corpus-module / --corpus-file to point at
// a test fixture instead.
import { pathToFileURL } from 'node:url';

export const DEFAULT_CORPUS_MODULE = new URL('../../corpus/readers.mjs', import.meta.url).href;

function toSpecifier(modulePath) {
  return /^[a-z][a-z0-9+.-]*:/i.test(modulePath) ? modulePath : pathToFileURL(modulePath).href;
}

/** Imports the readers.mjs module (default path, or an override for tests/fixtures). */
export async function loadReaderCorpusModule(modulePath = DEFAULT_CORPUS_MODULE) {
  try {
    return await import(toSpecifier(modulePath));
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      const notFound = new Error(`reader corpus module not found at ${modulePath} (Seam 1 not landed yet? pass --corpus-module for a fixture)`);
      notFound.cause = error;
      throw notFound;
    }
    throw error;
  }
}

/** { module, corpus } — corpus loaded from `corpusFile`, or the module's own default file. */
export async function loadReaderCorpusContext({ corpusModule, corpusFile } = {}) {
  const mod = await loadReaderCorpusModule(corpusModule);
  const file = corpusFile ?? mod.READER_CORPUS_FILE;
  const corpus = await mod.loadReaderCorpus(file);
  return { module: mod, corpus, file };
}

export function findIntent(corpus, intentId) {
  return corpus.intents?.find((intent) => intent.id === intentId);
}

export function findPersona(corpus, personaId) {
  return corpus.personas?.find((persona) => persona.id === personaId);
}
