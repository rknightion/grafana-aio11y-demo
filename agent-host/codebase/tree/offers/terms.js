'use strict';

// Local mirror of a few offers for the compliance checks below. The live data (in the shape the
// demo MCP server returns) lives in apps/mcp-tools/src/data/offers.json; this file is
// deliberately smaller and only for exercising rgCheck.js and wording.js.
const terms = [
  {
    id: 'offer-crossbar-football-welcome',
    bookmaker: 'Crossbar Bet',
    market: 'football',
    min_age: 18,
    terms: 'New customers only. Min deposit 10. Min stake 10 on odds of 1.5 or greater. Please play responsibly. 18+.',
  },
  {
    id: 'offer-halftime-football-acca',
    bookmaker: 'Halftime Odds',
    market: 'football',
    min_age: 18,
    terms: 'Applies to accumulators of 5 or more selections at odds of 1.2 or greater per leg. Gambling can be addictive.',
  },
  {
    id: 'offer-longshot-general-cashback',
    bookmaker: 'Longshot & Co',
    market: 'general',
    min_age: 18,
    terms: 'Weekly cashback on net losses up to 20. Terms apply.',
  },
];

module.exports = { terms };
