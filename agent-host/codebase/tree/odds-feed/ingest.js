'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalise } = require('./normalise');

function ingest(snapshotPath = path.join(__dirname, 'fixtures-snapshot.json')) {
  const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  return normalise(raw);
}

module.exports = { ingest };
