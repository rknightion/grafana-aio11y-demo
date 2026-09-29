'use strict';

// Turns a raw feed export (odds-feed/fixtures-snapshot.json, or whatever ingest.js reads) into
// the { fixture: { outcome: { bookmaker: price } } } shape the rest of the codebase expects -
// the same shape apps/mcp-tools serves.
function normalise(rawRows) {
  const byFixture = {};
  for (const row of rawRows) {
    const price = Number(row.price);
    if (!Number.isFinite(price)) continue;
    const fixture = byFixture[row.fixture] || (byFixture[row.fixture] = {});
    const outcome = fixture[row.outcome] || (fixture[row.outcome] = {});
    // BUG: bookmaker names from the feed sometimes carry a trailing space ("Crossbar Bet ").
    // We should trim here so "Crossbar Bet " and "Crossbar Bet" collapse onto one key, but we
    // don't - see the currently-red case in odds-feed/test/normalise.test.js.
    outcome[row.book] = price;
  }
  return byFixture;
}

module.exports = { normalise };
