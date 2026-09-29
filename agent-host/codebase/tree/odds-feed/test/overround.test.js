'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { overround } = require('../overround');

test('a fair book has zero overround', () => {
  assert.ok(Math.abs(overround({ home: 2, away: 2 })) < 1e-9);
});

test('a book with a margin has positive overround', () => {
  const result = overround({ home: 1.9, draw: 3.4, away: 4.0 });
  assert.ok(result > 0);
});
