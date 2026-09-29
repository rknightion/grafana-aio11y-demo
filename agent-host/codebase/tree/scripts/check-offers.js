#!/usr/bin/env node
'use strict';

// Quick CLI wrapper around offers/rgCheck.js for a terminal spot-check. Real audits should pull
// live offers through the demo MCP server; this only checks the local offers/terms.js fixtures.
const { terms } = require('../offers/terms');
const { checkOffer } = require('../offers/rgCheck');

for (const offer of terms) {
  const result = checkOffer(offer);
  const status = result.ageOk && result.rgOk ? 'PASS' : 'FAIL';
  console.log(`${status}\t${result.id}\tage=${result.ageOk}\trg=${result.rgOk}`);
}
