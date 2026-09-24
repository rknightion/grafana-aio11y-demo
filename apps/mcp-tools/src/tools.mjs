// The shared tool contract for Touchline Times.
//
// One implementation, two consumers:
//   - src/server.mjs in this package exposes the tools over stdio MCP (Claude Code uses it), and
//   - apps/agents imports TOOLS (package export "@touchline/mcp-tools/tools") and registers the
//     same four tools as in-app agent tools on Amazon Bedrock.
//
// Contract for every TOOLS entry:
//   { name: string, description: string, inputSchema: <plain JSON Schema object>, handler(args) }
// - inputSchema is plain JSON Schema (the wire format MCP tools/list expects), never Zod.
// - handler(args) is pure and resolves to a plain JSON-serialisable object. An unknown team or
//   fixture is a structured `{ error: "..." }` result, never a thrown exception.
// - No network calls and no clock reads: output derives only from the fixtures under src/data/.
// - This module must not import the MCP SDK, so the agents image can use it without the SDK.
//
// Every club, competition, venue, bookmaker and offer in src/data/ is fictional.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(name) {
  const filePath = path.join(__dirname, 'data', name);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const FIXTURES = loadJson('fixtures.json');
const ODDS = loadJson('odds.json');
const NEWS = loadJson('news.json');
const HISTORY = loadJson('history.json');
const OFFERS = loadJson('offers.json');

const BOOKMAKERS = ['Crossbar Bet', 'Halftime Odds', 'Longshot & Co'];

function norm(str) {
  return String(str ?? '').trim().toLowerCase();
}

function fixtureSummary(fixture) {
  return {
    id: fixture.id,
    sport: fixture.sport,
    competition: fixture.competition,
    home: fixture.home,
    away: fixture.away,
    kickoff: fixture.kickoff,
    venue: fixture.venue
  };
}

/**
 * The offers market ("football" | "basketball" | "general") implied by free text, from the clubs it
 * names. Used by the agents to keep offers relevant to the fixture being discussed.
 */
export function marketForText(text) {
  const haystack = norm(text);
  const match = FIXTURES.find((f) => haystack.includes(norm(f.home)) || haystack.includes(norm(f.away)));
  if (match) return match.sport;
  if (/\bbasketball\b/.test(haystack)) return 'basketball';
  if (/\bfootball\b/.test(haystack)) return 'football';
  return 'general';
}

/** List every fixture in the seed data, lightest-weight summary form. */
export function listFixtures() {
  return { fixtures: FIXTURES.map(fixtureSummary) };
}

function findFixtureById(fixtureId) {
  return FIXTURES.find((f) => f.id === fixtureId) ?? null;
}

function findFixturesByTeam(team) {
  const needle = norm(team);
  return FIXTURES.filter((f) => norm(f.home) === needle || norm(f.away) === needle);
}

function bestPricePerOutcome(outcomeOdds) {
  // Decimal odds: higher price is better for the bettor.
  const best = {};
  for (const [outcome, byBookmaker] of Object.entries(outcomeOdds)) {
    let bestBookmaker = null;
    let bestPrice = -Infinity;
    for (const [bookmaker, price] of Object.entries(byBookmaker)) {
      if (price > bestPrice) {
        bestPrice = price;
        bestBookmaker = bookmaker;
      }
    }
    best[outcome] = { bookmaker: bestBookmaker, price: bestPrice };
  }
  return best;
}

function oddsForFixture(fixture) {
  const outcomeOdds = ODDS[fixture.id];
  if (!outcomeOdds) {
    return { error: `No odds available for fixture: ${fixture.id}` };
  }
  return {
    fixture: fixtureSummary(fixture),
    bookmakers: BOOKMAKERS,
    odds: outcomeOdds,
    best_price: bestPricePerOutcome(outcomeOdds)
  };
}

/**
 * get_odds({ fixture_id?, team? })
 * - No args: lists all fixtures (see listFixtures()).
 * - fixture_id: odds for that one fixture.
 * - team: odds for every upcoming fixture involving that team (one result if
 *   only one fixture matches, a `fixtures` array if more than one matches).
 * Unknown fixture_id/team -> { error }.
 */
function getOdds(args = {}) {
  const { fixture_id, team } = args;

  if (!fixture_id && !team) {
    return listFixtures();
  }

  if (fixture_id) {
    const fixture = findFixtureById(fixture_id);
    if (!fixture) {
      return { error: `Unknown fixture_id: ${fixture_id}` };
    }
    return oddsForFixture(fixture);
  }

  const matches = findFixturesByTeam(team);
  if (matches.length === 0) {
    return { error: `Unknown team: ${team}` };
  }
  if (matches.length === 1) {
    return oddsForFixture(matches[0]);
  }
  return { team, fixtures: matches.map(oddsForFixture) };
}

/**
 * get_news({ team })
 * Recent news items for a team. Unknown team -> { error }.
 */
function getNews(args = {}) {
  const { team } = args;
  if (!team) {
    return { error: 'team is required' };
  }
  const key = Object.keys(NEWS).find((k) => norm(k) === norm(team));
  if (!key) {
    return { error: `Unknown team: ${team}` };
  }
  return { team: key, items: NEWS[key] };
}

/**
 * get_history({ home, away })
 * Last 5 head-to-head results between two teams, regardless of which side of
 * the fixture is currently "home". Unknown pairing -> { error }.
 */
function getHistory(args = {}) {
  const { home, away } = args;
  if (!home || !away) {
    return { error: 'home and away are required' };
  }
  const entry = HISTORY.find((h) => {
    const pairForward = norm(h.home) === norm(home) && norm(h.away) === norm(away);
    const pairReverse = norm(h.home) === norm(away) && norm(h.away) === norm(home);
    return pairForward || pairReverse;
  });
  if (!entry) {
    return { error: `No head-to-head history for ${home} vs ${away}` };
  }
  return { home, away, results: entry.results };
}

/**
 * get_offers({ market? })
 * Affiliate offers, always including terms, min_age and the responsible
 * gambling disclosure. market filters to "football" | "basketball" |
 * "general" (case-insensitive); omitted returns every offer.
 */
function getOffers(args = {}) {
  const { market } = args;
  const offers = market
    ? OFFERS.filter((o) => norm(o.market) === norm(market))
    : OFFERS;
  if (market && offers.length === 0) {
    return { error: `No offers for market: ${market}`, market };
  }
  return { market: market ?? 'all', offers };
}

export const TOOLS = [
  {
    name: 'get_odds',
    description:
      'Get odds from 3 fictional bookmakers (Crossbar Bet, Halftime Odds, Longshot & Co) for an upcoming fixture, plus the best price per outcome. Pass fixture_id or team to narrow; omit both to list all fixtures.',
    inputSchema: {
      type: 'object',
      properties: {
        fixture_id: {
          type: 'string',
          description: 'Fixture id, e.g. "fx-2026-10-03-hbc-ngr". See get_odds() with no args for the list.'
        },
        team: {
          type: 'string',
          description: 'Team name, e.g. "Harbour City". Matches any fixture where the team plays home or away.'
        }
      },
      additionalProperties: false
    },
    handler: getOdds
  },
  {
    name: 'get_news',
    description: 'Get recent short news items for a team.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team name, e.g. "Northgate Rovers".' }
      },
      required: ['team'],
      additionalProperties: false
    },
    handler: getNews
  },
  {
    name: 'get_history',
    description: 'Get the last 5 head-to-head results between two teams.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Home team name, e.g. "Stonebridge Saints".' },
        away: { type: 'string', description: 'Away team name, e.g. "Bramley Rangers".' }
      },
      required: ['home', 'away'],
      additionalProperties: false
    },
    handler: getHistory
  },
  {
    name: 'get_offers',
    description:
      'Get affiliate offers from fictional bookmakers, each with terms, min_age and a responsible-gambling disclosure. Optionally filter by market.',
    inputSchema: {
      type: 'object',
      properties: {
        market: {
          type: 'string',
          description: 'Optional market filter: "football", "basketball", or "general".'
        }
      },
      additionalProperties: false
    },
    handler: getOffers
  }
];
