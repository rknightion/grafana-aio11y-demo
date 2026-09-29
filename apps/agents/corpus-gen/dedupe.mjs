// Text normalisation and near-duplicate detection shared by every corpus-gen candidate kind.
// Pure functions, no I/O, so the dedupe rules are unit-testable without a model call.

/** lowercase, drop placeholder braces, drop punctuation, collapse whitespace. */
export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[{}]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value) {
  const normalised = normalizeText(value);
  return normalised ? normalised.split(' ') : [];
}

/** Token Jaccard similarity in [0, 1]. Two empty strings are treated as identical (1). */
export function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

/** True when `text` is an exact (normalised) or near (Jaccard >= threshold) match of any in `existing`. */
export function isDuplicate(text, existing, threshold = 0.8) {
  const normalised = normalizeText(text);
  return existing.some((item) => normalizeText(item) === normalised || jaccardSimilarity(text, item) >= threshold);
}

/**
 * Filters `candidates` against `existing` plus each other (in order), so the batch itself never
 * accumulates near-duplicates. Returns { accepted, rejected: [{ text, reason }] }.
 */
export function dedupeTexts(candidates, existing = [], threshold = 0.8) {
  const accepted = [];
  const rejected = [];
  const seen = [...existing];
  for (const text of candidates) {
    if (typeof text !== 'string' || !text.trim()) { rejected.push({ text, reason: 'empty' }); continue; }
    if (isDuplicate(text, seen, threshold)) { rejected.push({ text, reason: 'duplicate' }); continue; }
    accepted.push(text);
    seen.push(text);
  }
  return { accepted, rejected };
}
