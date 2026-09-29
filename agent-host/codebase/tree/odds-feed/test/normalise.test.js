'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalise } = require('../normalise');

test('groups prices by fixture and outcome', () => {
  const out = normalise([
    { fixture: 'fx-1', book: 'Crossbar Bet', outcome: 'home', price: '2.30' },
    { fixture: 'fx-1', book: 'Halftime Odds', outcome: 'home', price: '2.25' },
  ]);
  assert.equal(out['fx-1'].home['Crossbar Bet'], 2.3);
  assert.equal(out['fx-1'].home['Halftime Odds'], 2.25);
});

test('drops rows with a non-numeric price', () => {
  const out = normalise([
    { fixture: 'fx-1', book: 'Crossbar Bet', outcome: 'home', price: '2.30' },
    { fixture: 'fx-1', book: 'Crossbar Bet', outcome: 'away', price: 'n/a' },
  ]);
  assert.equal(out['fx-1'].home['Crossbar Bet'], 2.3);
  assert.equal(out['fx-1'].away, undefined);
});

// This is the one that's currently red: the feed export trims inconsistently and normalise()
// should collapse "Crossbar Bet " onto "Crossbar Bet".
test('trims a trailing space on the bookmaker name', () => {
  const out = normalise([{ fixture: 'fx-1', book: 'Crossbar Bet ', outcome: 'home', price: '2.30' }]);
  assert.equal(out['fx-1'].home['Crossbar Bet'], 2.3);
});
