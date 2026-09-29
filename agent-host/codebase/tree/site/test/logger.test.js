'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { logRequest } = require('../middleware/logger');

test('log line carries method and url', () => {
  const line = logRequest({ method: 'GET', url: '/' });
  assert.match(line, /GET \//);
});
