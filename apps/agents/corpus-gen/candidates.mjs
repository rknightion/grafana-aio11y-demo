// Turns a model's raw JSON candidates into accepted/rejected entries, per corpus-gen --kind.
// Pure functions: validateReaderCorpus is always passed in (the real Seam 1 export, or a fake for
// tests), so nothing here needs apps/corpus/readers.mjs to exist to be unit-tested.
import { dedupeTexts, isDuplicate } from './dedupe.mjs';
import { formatPromptFile, slugifyStem } from './prompt-format.mjs';

/**
 * New phrasings/followups for an existing intent. `raw` is the model's parsed JSON array of
 * { field: 'phrasings' | 'followups', text }. Accepted entries are folded into a working copy of
 * the corpus one at a time, so validateReaderCorpus sees the cumulative effect (duplicate ids,
 * placeholder rules, ...) before the next candidate is checked.
 */
export function reviewReaderIntentCandidates({ corpus, intentId, raw, validateReaderCorpus, dedupeThreshold = 0.8 }) {
  const intent = corpus.intents?.find((item) => item.id === intentId);
  if (!intent) throw new Error(`unknown intent id: ${intentId}`);
  const accepted = [];
  const rejected = [];
  let working = structuredClone(corpus);
  for (const field of ['phrasings', 'followups']) {
    const texts = raw.filter((item) => item && item.field === field && typeof item.text === 'string').map((item) => item.text);
    const existing = intent[field] ?? [];
    const deduped = dedupeTexts(texts, existing, dedupeThreshold);
    for (const item of deduped.rejected) rejected.push({ field, text: item.text, reason: item.reason });
    for (const text of deduped.accepted) {
      const attempt = structuredClone(working);
      const attemptIntent = attempt.intents.find((item) => item.id === intentId);
      attemptIntent[field] = [...(attemptIntent[field] ?? []), text];
      const errors = validateReaderCorpus(attempt);
      if (errors.length) { rejected.push({ field, text, reason: errors.join('; ') }); continue; }
      accepted.push({ field, text });
      working = attempt;
    }
  }
  return { accepted, rejected };
}

/**
 * Whole new intents proposed for an existing persona. `raw` is an array of
 * { id, phrasings, followups }; personas is always forced to [personaId] (a model-suggested extra
 * persona is never trusted).
 */
export function reviewReaderPersonaCandidates({ corpus, personaId, raw, validateReaderCorpus, dedupeThreshold = 0.8 }) {
  const persona = corpus.personas?.find((item) => item.id === personaId);
  if (!persona) throw new Error(`unknown persona id: ${personaId}`);
  const seenIds = new Set((corpus.intents ?? []).map((intent) => intent.id));
  const existingTexts = (corpus.intents ?? []).flatMap((intent) => [...(intent.phrasings ?? []), ...(intent.followups ?? [])]);
  const accepted = [];
  const rejected = [];
  let working = structuredClone(corpus);
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) { rejected.push({ reason: 'missing id' }); continue; }
    const id = item.id.trim();
    if (seenIds.has(id)) { rejected.push({ id, reason: 'duplicate intent id' }); continue; }
    const phrasings = Array.isArray(item.phrasings) ? item.phrasings.filter((value) => typeof value === 'string' && value.trim()) : [];
    const followups = Array.isArray(item.followups) ? item.followups.filter((value) => typeof value === 'string' && value.trim()) : [];
    if (!phrasings.length) { rejected.push({ id, reason: 'no phrasings' }); continue; }
    if ([...phrasings, ...followups].some((text) => isDuplicate(text, existingTexts, dedupeThreshold))) {
      rejected.push({ id, reason: 'phrasing duplicates an existing question' });
      continue;
    }
    const candidateIntent = { id, personas: [personaId], phrasings, followups };
    const attempt = structuredClone(working);
    attempt.intents = [...(attempt.intents ?? []), candidateIntent];
    const errors = validateReaderCorpus(attempt);
    if (errors.length) { rejected.push({ id, reason: errors.join('; ') }); continue; }
    accepted.push(candidateIntent);
    seenIds.add(id);
    working = attempt;
  }
  return { accepted, rejected };
}

/**
 * New Seam 2 prompt files for a team or a scenario stem. `raw` is an array of
 * { title, effort?, budget?, turns }; `team` is always the caller's, never model-suggested.
 */
export function reviewDevPromptCandidates({ existingPrompts, raw, team, stemHint, dedupeThreshold = 0.8 }) {
  const existingTitles = existingPrompts.map((prompt) => prompt.title);
  const existingFirstTurns = existingPrompts.map((prompt) => prompt.turns[0]);
  const usedStems = existingPrompts.map((prompt) => prompt.stem);
  const accepted = [];
  const rejected = [];
  for (const item of raw) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) { rejected.push({ reason: 'missing title' }); continue; }
    const title = item.title.trim();
    if (!Array.isArray(item.turns) || !item.turns.length) { rejected.push({ title, reason: 'missing turns' }); continue; }
    if (isDuplicate(title, existingTitles, dedupeThreshold) || isDuplicate(item.turns[0], existingFirstTurns, dedupeThreshold)) {
      rejected.push({ title, reason: 'duplicate of an existing scenario' });
      continue;
    }
    let file, parsed;
    try {
      parsed = { team, title, ...(item.effort !== undefined ? { effort: item.effort } : {}), ...(item.budget !== undefined ? { budget: Number(item.budget) } : {}), turns: item.turns };
      file = formatPromptFile(parsed);
    } catch (error) { rejected.push({ title, reason: error.message }); continue; }
    const stem = slugifyStem(stemHint ? `${stemHint}-${title}` : title, usedStems);
    usedStems.push(stem);
    existingTitles.push(title);
    existingFirstTurns.push(item.turns[0]);
    accepted.push({ stem, file, parsed });
  }
  return { accepted, rejected };
}
