// Committed corpus of reader personas, intents and phrasings shared by the in-app load generator
// (apps/agents/src/loadgen.mjs) and the site-browser CronJob (apps/site/src/browser.mjs), so both
// pieces of synthetic traffic sound like the same fictional readership. Plain ESM, no npm
// dependencies, so both images can copy this directory verbatim (see their Dockerfiles).
//
// Shape of readers.json:
//   { version: 1,
//     personas: [{ id, description, weight, readers: [stableReaderId, ...], rating: { probability, goodWhenOk, goodWhenBad } }],
//     intents:  [{ id, personas: [personaId, ...], phrasings: [text, ...], followups: [text, ...] }],
//     injection: { intents: [intentId, ...], markers: [text, ...] } }
// Placeholders allowed in phrasings/followups: {home}, {away} (one fixture side each), {team}
// (either side, picked at render time).
import { readFileSync } from 'node:fs';

export const READER_CORPUS_FILE = new URL('./readers.json', import.meta.url);

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLACEHOLDERS = new Set(['{home}', '{away}', '{team}']);

function isProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function checkPlaceholderStrings(list, label, errors) {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return;
  }
  for (const [index, text] of list.entries()) {
    if (typeof text !== 'string' || !text.trim()) {
      errors.push(`${label}[${index}] must be a non-empty string`);
      continue;
    }
    for (const match of text.match(/\{[^}]*\}/g) ?? []) {
      if (!PLACEHOLDERS.has(match)) errors.push(`${label}[${index}] has an unsupported placeholder: ${match}`);
    }
  }
}

/**
 * Validates a parsed reader corpus. Pure, no I/O. Returns an array of human-readable error
 * strings, empty when the corpus is valid.
 */
export function validateReaderCorpus(corpus) {
  const errors = [];
  if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)) return ['corpus must be an object'];
  if (corpus.version !== 1) errors.push('version must be 1');

  const personas = Array.isArray(corpus.personas) ? corpus.personas : null;
  if (!personas || personas.length === 0) errors.push('personas must be a non-empty array');
  const intents = Array.isArray(corpus.intents) ? corpus.intents : null;
  if (!intents || intents.length === 0) errors.push('intents must be a non-empty array');
  if (!personas || !intents) return errors;

  const personaIds = new Set();
  const readerIds = new Set();
  for (const [index, persona] of personas.entries()) {
    const label = `personas[${index}]`;
    if (!persona || typeof persona !== 'object') { errors.push(`${label} must be an object`); continue; }
    if (typeof persona.id !== 'string' || !ID_PATTERN.test(persona.id)) errors.push(`${label}.id must be kebab-case`);
    else if (personaIds.has(persona.id)) errors.push(`duplicate persona id: ${persona.id}`);
    else personaIds.add(persona.id);
    if (typeof persona.description !== 'string' || !persona.description.trim()) errors.push(`${label}.description must be a non-empty string`);
    if (!Number.isFinite(persona.weight) || persona.weight <= 0) errors.push(`${label}.weight must be a number > 0`);
    if (!Array.isArray(persona.readers) || persona.readers.length === 0) {
      errors.push(`${label}.readers must be a non-empty array`);
    } else {
      for (const reader of persona.readers) {
        if (typeof reader !== 'string' || !reader.trim()) errors.push(`${label}.readers must contain non-empty strings`);
        else if (readerIds.has(reader)) errors.push(`duplicate reader id across personas: ${reader}`);
        else readerIds.add(reader);
      }
    }
    const rating = persona.rating;
    if (!rating || typeof rating !== 'object') errors.push(`${label}.rating must be an object`);
    else for (const key of ['probability', 'goodWhenOk', 'goodWhenBad']) {
      if (!isProbability(rating[key])) errors.push(`${label}.rating.${key} must be a number between 0 and 1`);
    }
  }

  const intentIds = new Set();
  for (const [index, intent] of intents.entries()) {
    const label = `intents[${index}]`;
    if (!intent || typeof intent !== 'object') { errors.push(`${label} must be an object`); continue; }
    if (typeof intent.id !== 'string' || !ID_PATTERN.test(intent.id)) errors.push(`${label}.id must be kebab-case`);
    else if (intentIds.has(intent.id)) errors.push(`duplicate intent id: ${intent.id}`);
    else intentIds.add(intent.id);
    if (!Array.isArray(intent.personas) || intent.personas.length === 0) {
      errors.push(`${label}.personas must be a non-empty array`);
    } else {
      for (const personaId of intent.personas) if (!personaIds.has(personaId)) errors.push(`${label}.personas references unknown persona: ${personaId}`);
    }
    checkPlaceholderStrings(intent.phrasings, `${label}.phrasings`, errors);
    checkPlaceholderStrings(intent.followups, `${label}.followups`, errors);
  }

  const injection = corpus.injection;
  if (!injection || typeof injection !== 'object') {
    errors.push('injection must be an object');
  } else {
    if (!Array.isArray(injection.intents) || injection.intents.length === 0) {
      errors.push('injection.intents must be a non-empty array');
    } else {
      for (const intentId of injection.intents) if (!intentIds.has(intentId)) errors.push(`injection.intents references unknown intent: ${intentId}`);
    }
    if (!Array.isArray(injection.markers) || injection.markers.length === 0) {
      errors.push('injection.markers must be a non-empty array');
    } else {
      for (const [index, marker] of injection.markers.entries()) if (typeof marker !== 'string' || !marker.trim()) errors.push(`injection.markers[${index}] must be a non-empty string`);
    }
  }

  // Every persona that asks at least one intent, and every intent reachable from a real persona:
  // a validator that let those drift apart would hide a typo'd id instead of catching it.
  if (personaIds.size && intentIds.size) {
    const askedBy = new Set(intents.flatMap((intent) => intent && typeof intent === 'object' && Array.isArray(intent.personas) ? intent.personas : []));
    for (const personaId of personaIds) if (!askedBy.has(personaId)) errors.push(`persona is never asked by any intent: ${personaId}`);
  }

  return errors;
}

/** Loads and validates the reader corpus (synchronous; throws on an invalid corpus). */
export function loadReaderCorpus(file = READER_CORPUS_FILE) {
  let corpus;
  try { corpus = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`invalid reader corpus: ${error.message}`); }
  const errors = validateReaderCorpus(corpus);
  if (errors.length > 0) throw new Error(`invalid reader corpus: ${errors.join('; ')}`);
  return corpus;
}

/**
 * Substitutes {home}/{away}/{team} in `text` from `fixture` ({ home, away }). {team} picks one
 * side at random (random() < 0.5 -> home, else away); pass a seeded/fixed random for determinism.
 */
export function renderPhrasing(text, fixture, random = Math.random) {
  return text.replace(/\{(home|away|team)\}/g, (_, key) => {
    if (key === 'team') return random() < 0.5 ? fixture.home : fixture.away;
    return fixture[key];
  });
}
