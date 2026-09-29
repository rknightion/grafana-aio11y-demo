'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderHome, renderMatchPage } = require('../render');

test('home page lists every fixture', () => {
  const html = renderHome();
  assert.match(html, /Harbour City v Northgate Rovers/);
  assert.match(html, /Kingsbridge United v Ashford Athletic/);
});

test('match page titles the page after the fixture', () => {
  const html = renderMatchPage({ home: 'Redvale', away: 'Fellgate Wanderers', competition: 'Northern Cup', kickoff: 'Tue 19:45' });
  assert.match(html, /Redvale v Fellgate Wanderers - Touchline Times/);
});
