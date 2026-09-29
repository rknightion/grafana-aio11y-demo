// Loads existing agent-host/prompts/*.txt (Seam 2) as few-shot context for dev-team / dev-scenario
// generation. Tolerant of the directory not existing yet (lane B2 is mid-rewrite; a fresh checkout
// or a test fixture may point elsewhere via --prompts-dir).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePromptFile } from './prompt-format.mjs';

export const DEFAULT_PROMPTS_DIR = new URL('../../../agent-host/prompts/', import.meta.url).pathname;

/** Every parseable prompt file in `dir`, as { stem, team, title, effort, budget, turns }. */
export async function loadDevPrompts(dir = DEFAULT_PROMPTS_DIR) {
  let entries;
  try { entries = await readdir(dir); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const prompts = [];
  for (const name of entries.filter((entry) => entry.endsWith('.txt')).sort()) {
    const text = await readFile(join(dir, name), 'utf8');
    try { prompts.push({ stem: name.slice(0, -4), ...parsePromptFile(text) }); }
    catch { /* not (yet) a Seam 2 file; skip rather than fail the whole load */ }
  }
  return prompts;
}

// PII probes (Seam 2: filenames starting "pii-") are a deliberate, structurally different
// category (the preflight deny guard should block them) - never grounding for an ordinary
// dev-team/dev-scenario candidate, which should read like a normal engineering task.
function isPiiProbe(prompt) { return prompt.stem.startsWith('pii-'); }

export function promptsForTeam(prompts, team) {
  return prompts.filter((prompt) => prompt.team === team && !isPiiProbe(prompt));
}

/** Prompts whose stem or title mentions `stem` (case-insensitive substring). */
export function promptsForScenarioStem(prompts, stem) {
  const needle = String(stem ?? '').toLowerCase();
  return prompts.filter((prompt) => !isPiiProbe(prompt) && (prompt.stem.toLowerCase().includes(needle) || prompt.title.toLowerCase().includes(needle)));
}
