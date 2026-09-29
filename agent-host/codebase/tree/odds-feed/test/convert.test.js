'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDecimal, toAmerican } = require('../convert');

test('formatDecimal fixes to two places', () => {
  assert.equal(formatDecimal(2.3), '2.30');
  assert.equal(formatDecimal(1.5), '1.50');
});

test('toAmerican is positive for an underdog', () => {
  assert.equal(toAmerican(3.0), '+200');
});

test('toAmerican is negative for a favourite', () => {
  assert.equal(toAmerican(1.5), '-200');
});

// TODO: toFractionString has no coverage at all. Someone asked for "6/4"-style fractions for the
// print page and we're not sure the current implementation gives sensible output - add cases
// here before anyone relies on it.
