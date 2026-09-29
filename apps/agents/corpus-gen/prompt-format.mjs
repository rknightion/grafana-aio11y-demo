// Seam 2 (frozen, see AIO-0001 seams.md): agent-host/prompts/<scenario>.txt format.
//   team: trading                 # required: newsroom | trading | platform
//   title: Short title            # required, one line
//   effort: medium                # optional: low | medium | high
//   budget: 0.50                  # optional USD
//   ---
//   first user turn (multi-line allowed)
//   --- followup
//   second user turn
// This module owns parsing and formatting; nothing here writes to agent-host/prompts itself.
export const TEAMS = ['newsroom', 'trading', 'platform'];
export const EFFORTS = ['low', 'medium', 'high'];
const HEADER_KEYS = ['team', 'title', 'effort', 'budget'];
const FOLLOWUP_MARKER = '--- followup';

/** Parses prompt-file text into { team, title, effort, budget, turns }. Throws on any violation. */
export function parsePromptFile(text) {
  if (typeof text !== 'string') throw new Error('prompt file must be a string');
  const lines = text.split('\n');
  const headerEnd = lines.findIndex((line) => line.trim() === '---');
  if (headerEnd === -1) throw new Error('prompt file is missing the "---" header delimiter');
  const header = {};
  for (const raw of lines.slice(0, headerEnd)) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(':');
    if (at === -1) throw new Error(`invalid header line: ${raw}`);
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!HEADER_KEYS.includes(key)) throw new Error(`unknown header key: ${key}`);
    if (header[key] !== undefined) throw new Error(`duplicate header key: ${key}`);
    header[key] = value;
  }
  if (!TEAMS.includes(header.team)) throw new Error(`team must be one of ${TEAMS.join(', ')} (got ${header.team ?? '<missing>'})`);
  if (!header.title) throw new Error('title is required');
  let effort;
  if (header.effort !== undefined) {
    if (!EFFORTS.includes(header.effort)) throw new Error(`effort must be one of ${EFFORTS.join(', ')} (got ${header.effort})`);
    effort = header.effort;
  }
  let budget;
  if (header.budget !== undefined) {
    budget = Number(header.budget);
    if (!Number.isFinite(budget) || budget <= 0) throw new Error(`budget must be a positive number (got ${header.budget})`);
  }
  const turns = [];
  let current = [];
  for (const line of lines.slice(headerEnd + 1)) {
    if (line.trim() === FOLLOWUP_MARKER) { turns.push(current.join('\n').trim()); current = []; }
    else current.push(line);
  }
  turns.push(current.join('\n').trim());
  if (!turns.length || turns.some((turn) => !turn)) throw new Error('every turn (first turn and each follow-up) must be non-empty');
  return { team: header.team, title: header.title, ...(effort !== undefined ? { effort } : {}), ...(budget !== undefined ? { budget } : {}), turns };
}

/** The inverse of parsePromptFile: throws on the same violations, so a round trip always parses. */
export function formatPromptFile({ team, title, effort, budget, turns }) {
  if (!TEAMS.includes(team)) throw new Error(`team must be one of ${TEAMS.join(', ')} (got ${team})`);
  if (!title || !String(title).trim()) throw new Error('title is required');
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error(`effort must be one of ${EFFORTS.join(', ')} (got ${effort})`);
  if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) throw new Error('budget must be a positive number');
  if (!Array.isArray(turns) || !turns.length || turns.some((turn) => typeof turn !== 'string' || !turn.trim())) {
    throw new Error('turns must be a non-empty array of non-empty strings');
  }
  const header = [`team: ${team}`, `title: ${String(title).trim()}`, ...(effort !== undefined ? [`effort: ${effort}`] : []), ...(budget !== undefined ? [`budget: ${budget}`] : [])];
  const body = turns.map((turn) => turn.trim()).join(`\n${FOLLOWUP_MARKER}\n`);
  return `${header.join('\n')}\n---\n${body}\n`;
}

/** Filesystem-safe stem derived from a title, unique against `taken` (appends -2, -3, ... on collision). */
export function slugifyStem(title, taken = []) {
  const base = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'scenario';
  const used = new Set(taken.map((value) => value.toLowerCase()));
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
