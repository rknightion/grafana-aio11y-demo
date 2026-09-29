// Builds the instruction sent to the generator model, per --kind. Pure string-building: no I/O,
// no model call, so --dry-run can print exactly what would be sent.
const COMMON_RULES = 'Respond with ONLY a JSON array (no markdown fences, no commentary, no trailing text) with exactly the requested number of items, or fewer only if you cannot produce distinct, non-duplicate items.';

function json(value) { return JSON.stringify(value, null, 2); }

export function buildGenerationPrompt({ kind, name, remaining, context }) {
  if (kind === 'reader-intent') {
    const { intent, personas } = context;
    const system = 'You write short, realistic questions a football-app reader might type into a chat box, for a fictional demo (Touchline Times). Keep the voice of the given personas: informal, terse, impatient. Never invent real teams, players or bookmakers beyond the fixtures given.';
    const user = [
      `Intent "${intent.id}" is asked by these reader personas:`, json(personas),
      '', 'Existing phrasings for this intent:', json(intent.phrasings ?? []),
      'Existing natural follow-ups after this intent is answered:', json(intent.followups ?? []),
      '', `Propose ${remaining} NEW items: a mix of new phrasings (alternate ways to ask the same intent) and new followups (what the reader says next).`,
      'Only these placeholders are allowed inside phrasing/followup text, and only if the existing examples use them: {home}, {away}, {team}. Do not invent other placeholders.',
      'Each item: {"field": "phrasings" | "followups", "text": "..."}.',
      COMMON_RULES,
    ].join('\n');
    return { system, user };
  }
  if (kind === 'reader-persona') {
    const { persona, sampleIntents } = context;
    const system = 'You design new question intents for a fictional football-app reader persona, for a demo (Touchline Times). Ground every new intent in the existing style; never invent real teams, players or bookmakers.';
    const user = [
      `Persona "${persona.id}": ${persona.description}`,
      '', 'A sample of existing intents (for style/format only; do not repeat them):', json(sampleIntents),
      '', `Propose ${remaining} NEW intents this persona might ask about, each with a unique kebab-case id, 2-4 phrasings and 0-2 followups.`,
      'Only these placeholders are allowed inside phrasing/followup text: {home}, {away}, {team}.',
      'Each item: {"id": "kebab-case-id", "phrasings": ["..."], "followups": ["..."]}.',
      COMMON_RULES,
    ].join('\n');
    return { system, user };
  }
  if (kind === 'dev-team' || kind === 'dev-scenario') {
    const { team, examples, stem } = context;
    const system = 'You write realistic engineering task prompts for a Claude Code developer session inside a fictional sports-media codebase (Touchline Times), for a demo. Prompts read like a real teammate\'s Slack ask: casual, specific, with a concrete deliverable. Never ask the agent to commit, push or leave its working directory (the harness already forbids that).';
    const user = [
      kind === 'dev-team' ? `Team: ${team} (their existing prompts, for style/scope only; do not repeat them):` : `Scenario family "${stem}" (existing related prompts, for style/scope only; do not repeat them):`,
      json(examples.map(({ title, effort, budget, turns }) => ({ title, effort, budget, turns }))),
      '', `Propose ${remaining} NEW developer session prompts for the ${team} team, each a distinct, concrete task grounded in the fictional Touchline codebase.`,
      'Each item: {"title": "short title", "effort": "low"|"medium"|"high" (optional), "budget": number in USD (optional), "turns": ["first user turn, multi-line ok", "optional followup turn, phrased as a reply to what Claude just did", ...]}.',
      'The first turn is the task itself. A followup turn (if any) reads like "no, the other file" or "also handle the edge case" - a natural continuation, not a restatement.',
      COMMON_RULES,
    ].join('\n');
    return { system, user };
  }
  throw new Error(`unknown kind: ${kind}`);
}
