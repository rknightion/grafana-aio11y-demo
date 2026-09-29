#!/usr/bin/env node
// The other half of the review-then-commit workflow (see docs/traffic-corpus.md): merges only the
// candidates a reviewer marked "accepted" in a corpus-gen review file into the real committed
// corpora. Never touches a "candidate" or "rejected" entry. Re-validates before writing anything;
// a merge that would make apps/corpus/readers.json invalid aborts with no write at all.
//
// Usage:
//   node apps/agents/corpus-gen/accept.mjs corpus-review/reader-intent-best-price-....json
//   node apps/agents/corpus-gen/accept.mjs <review-file> --dry-run
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadReaderCorpusContext } from './reader-corpus.mjs';
import { formatPromptFile, parsePromptFile } from './prompt-format.mjs';
import { DEFAULT_PROMPTS_DIR } from './dev-prompts.mjs';

export function parseArgs(argv) {
  const args = { dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { i++; if (i >= argv.length) throw new Error(`${arg} needs a value`); return argv[i]; };
    if (arg === '--corpus-module') args.corpusModule = next();
    else if (arg === '--corpus-file') args.corpusFile = next();
    else if (arg === '--prompts-dir') args.promptsDir = next();
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('usage: accept.mjs <review-file> [--corpus-module p] [--corpus-file p] [--prompts-dir p] [--dry-run]');
  args.reviewFile = positional[0];
  return args;
}

async function exists(path) { try { await access(path); return true; } catch { return false; } }

/**
 * Applies `accepted` reader-intent/reader-persona candidates to `corpus`, re-validating the whole
 * result once at the end. Throws (with no mutation visible to the caller) if the merged corpus is
 * invalid — accept.mjs never writes a broken readers.json.
 */
export function applyReaderCandidates(corpus, accepted, validateReaderCorpus) {
  if (!accepted.length) return corpus;
  const working = structuredClone(corpus);
  for (const candidate of accepted) {
    if (candidate.kind === 'reader-intent') {
      const intent = working.intents?.find((item) => item.id === candidate.intentId);
      if (!intent) throw new Error(`accepted candidate references unknown intent id: ${candidate.intentId}`);
      intent[candidate.field] = [...(intent[candidate.field] ?? []), candidate.text];
    } else if (candidate.kind === 'reader-persona') {
      if (working.intents?.some((item) => item.id === candidate.intent.id)) throw new Error(`accepted candidate's intent id already exists: ${candidate.intent.id}`);
      working.intents = [...(working.intents ?? []), candidate.intent];
    } else {
      throw new Error(`applyReaderCandidates got a non-reader candidate: ${candidate.kind}`);
    }
  }
  const errors = validateReaderCorpus(working);
  if (errors.length) throw new Error(`merging accepted candidates would make the reader corpus invalid:\n  ${errors.join('\n  ')}`);
  return working;
}

/** Re-validates and formats each accepted dev-team/dev-scenario candidate. Throws on any bad one. */
export function reformatDevCandidates(accepted) {
  return accepted.map((candidate) => {
    const parsed = parsePromptFile(candidate.file);
    return { stem: candidate.stem, file: formatPromptFile(parsed) };
  });
}

export async function runAccept(args, deps = {}) {
  const { log = console.log, warn = console.warn } = deps;
  const review = JSON.parse(await readFile(args.reviewFile, 'utf8'));
  const accepted = (review.candidates ?? []).filter((candidate) => candidate.status === 'accepted');
  if (!accepted.length) { warn(`accept: no candidate in ${args.reviewFile} is marked "accepted"; nothing to do.`); return { corpusChanged: false, promptFiles: [] }; }

  const readerCandidates = accepted.filter((candidate) => candidate.kind === 'reader-intent' || candidate.kind === 'reader-persona');
  const devCandidates = accepted.filter((candidate) => candidate.kind === 'dev-team' || candidate.kind === 'dev-scenario');
  const unknown = accepted.filter((candidate) => !readerCandidates.includes(candidate) && !devCandidates.includes(candidate));
  if (unknown.length) throw new Error(`accepted candidate(s) with an unrecognised kind: ${unknown.map((item) => item.kind).join(', ')}`);

  // Check everything before writing anything, so a bad review file leaves the corpus untouched.
  let merged, corpusFile;
  if (readerCandidates.length) {
    const { module: corpusModule, corpus, file } = await loadReaderCorpusContext({ corpusModule: args.corpusModule, corpusFile: args.corpusFile });
    corpusFile = file;
    merged = applyReaderCandidates(corpus, readerCandidates, corpusModule.validateReaderCorpus);
  }
  const prompts = [];
  if (devCandidates.length) {
    const promptsDir = args.promptsDir ?? DEFAULT_PROMPTS_DIR;
    const stems = new Set();
    for (const { stem, file } of reformatDevCandidates(devCandidates)) {
      if (stems.has(stem)) throw new Error(`two accepted candidates share the stem ${stem} (rename one in the review file and re-run)`);
      stems.add(stem);
      const target = join(promptsDir, `${stem}.txt`);
      if (await exists(target)) throw new Error(`refusing to overwrite an existing prompt file: ${target} (rename the candidate's stem in the review file and re-run)`);
      prompts.push({ target, file });
    }
  }

  const corpusChanged = merged !== undefined;
  if (corpusChanged) {
    if (!args.dryRun) await writeFile(corpusFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    log(`accept: ${args.dryRun ? 'would merge' : 'merged'} ${readerCandidates.length} reader-corpus candidate(s) into ${corpusFile}.`);
  }
  const promptFiles = [];
  for (const { target, file } of prompts) {
    if (!args.dryRun) await writeFile(target, file, { flag: 'wx' });
    promptFiles.push(target);
  }
  if (prompts.length) log(`accept: ${args.dryRun ? 'would write' : 'wrote'} ${promptFiles.length} prompt file(s): ${promptFiles.join(', ')}`);

  return { corpusChanged, corpusFile, promptFiles };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`accept: ${error.message}`); process.exitCode = 1; return; }
  try { await runAccept(args); }
  catch (error) { console.error(`accept: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
