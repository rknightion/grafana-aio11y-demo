'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasAgeMarker, hasResponsibleGamblingLine } = require('../rgCheck');

test('recognises an explicit 18+ marker', () => {
  assert.equal(hasAgeMarker('New customers only. 18+.'), true);
});

test('recognises the lower-case play-responsibly line', () => {
  assert.equal(hasResponsibleGamblingLine('Please play responsibly. 18+.'), true);
});

// Currently red: "Gambling can be addictive." is plainly a responsible-gambling line but the
// capitalised sentence-start "Gambling" doesn't match the lower-case check in rgCheck.js.
test('recognises a capitalised Gambling-can-be-addictive line', () => {
  assert.equal(
    hasResponsibleGamblingLine('Applies to accumulators of 5 or more selections. Gambling can be addictive.'),
    true,
  );
});
