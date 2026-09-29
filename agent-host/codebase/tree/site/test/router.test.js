'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { match } = require('../router');

test('matches the home route', () => {
  const route = match('GET', '/');
  assert.ok(route);
});

test('returns null for an unknown route', () => {
  assert.equal(match('GET', '/nope'), null);
});

test('ignores a query string when matching', () => {
  const route = match('GET', '/?utm_source=newsletter');
  assert.ok(route);
});
