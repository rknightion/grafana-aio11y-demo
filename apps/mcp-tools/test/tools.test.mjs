import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, listFixtures, marketForText } from '../src/tools.mjs';

function toolByName(name) {
  const tool = TOOLS.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} should exist`);
  return tool;
}

test('TOOLS exposes exactly the four expected tools', () => {
  assert.deepEqual(
    TOOLS.map((t) => t.name).sort(),
    ['get_history', 'get_news', 'get_odds', 'get_offers'].sort()
  );
  for (const tool of TOOLS) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.handler, 'function');
  }
});

test('listFixtures returns all 8 seed fixtures', () => {
  const { fixtures } = listFixtures();
  assert.equal(fixtures.length, 8);
  const football = fixtures.filter((f) => f.sport === 'football');
  const basketball = fixtures.filter((f) => f.sport === 'basketball');
  assert.equal(football.length, 6);
  assert.equal(basketball.length, 2);
  for (const f of fixtures) {
    assert.ok(f.id);
    assert.ok(f.home);
    assert.ok(f.away);
    assert.ok(f.kickoff);
  }
});

test('get_odds with no args lists fixtures', async () => {
  const result = await toolByName('get_odds').handler({});
  assert.equal(result.fixtures.length, 8);
});

test('get_odds by fixture_id returns odds and best price per outcome', async () => {
  const result = await toolByName('get_odds').handler({ fixture_id: 'fx-2026-10-03-hbc-ngr' });
  assert.equal(result.fixture.home, 'Harbour City');
  assert.equal(result.fixture.away, 'Northgate Rovers');
  assert.deepEqual(result.bookmakers, ['Crossbar Bet', 'Halftime Odds', 'Longshot & Co']);
  assert.ok(result.odds.home);
  assert.ok(result.odds.draw);
  assert.ok(result.odds.away);
  assert.equal(result.best_price.home.bookmaker, 'Longshot & Co');
  assert.equal(result.best_price.home.price, 2.35);
});

test('get_odds by team returns a single fixture result when exactly one match', async () => {
  const result = await toolByName('get_odds').handler({ team: 'harbour city' });
  assert.equal(result.fixture.home, 'Harbour City');
});

test('get_odds unknown fixture_id returns a structured error, not a throw', async () => {
  const result = await toolByName('get_odds').handler({ fixture_id: 'nope' });
  assert.equal(result.error, 'Unknown fixture_id: nope');
});

test('get_odds unknown team returns a structured error, not a throw', async () => {
  const result = await toolByName('get_odds').handler({ team: 'Nowhere Albion' });
  assert.match(result.error, /Unknown team/);
});

test('get_news returns items for a known team, case-insensitively', async () => {
  const result = await toolByName('get_news').handler({ team: 'NORTHGATE ROVERS' });
  assert.equal(result.team, 'Northgate Rovers');
  assert.ok(result.items.length > 0);
});

test('get_news unknown team returns a structured error, not a throw', async () => {
  const result = await toolByName('get_news').handler({ team: 'Nowhere Albion' });
  assert.match(result.error, /Unknown team/);
});

test('get_history returns 5 results for a known pairing', async () => {
  const result = await toolByName('get_history').handler({ home: 'Stonebridge Saints', away: 'Bramley Rangers' });
  assert.equal(result.results.length, 5);
});

test('get_history matches regardless of home/away orientation', async () => {
  const result = await toolByName('get_history').handler({ home: 'Bramley Rangers', away: 'Stonebridge Saints' });
  assert.equal(result.results.length, 5);
});

test('get_history unknown pairing returns a structured error, not a throw', async () => {
  const result = await toolByName('get_history').handler({ home: 'Harbour City', away: 'Nowhere Albion' });
  assert.match(result.error, /No head-to-head history/);
});

test('get_offers with no args returns every offer, each with terms/min_age/RG line', async () => {
  const result = await toolByName('get_offers').handler({});
  assert.equal(result.market, 'all');
  assert.ok(result.offers.length >= 3);
  for (const offer of result.offers) {
    assert.equal(offer.min_age, 18);
    assert.ok(offer.terms.length > 0);
    assert.ok(offer.responsible_gambling.length > 0);
  }
});

test('get_offers filters by market', async () => {
  const result = await toolByName('get_offers').handler({ market: 'basketball' });
  assert.ok(result.offers.length >= 1);
  for (const offer of result.offers) {
    assert.equal(offer.market, 'basketball');
  }
});

test('get_offers unknown market returns a structured error, not a throw', async () => {
  const result = await toolByName('get_offers').handler({ market: 'cricket' });
  assert.match(result.error, /No offers for market/);
});

test('marketForText maps named clubs to their sport and falls back to general', () => {
  assert.equal(marketForText('Offers for Metro Rockets vs Summit Hawks'), 'basketball');
  assert.equal(marketForText('offers for harbour city vs northgate rovers'), 'football');
  assert.equal(marketForText('Any welcome offers this week?'), 'general');
});
