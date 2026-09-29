'use strict';

const { layout } = require('./templates/layout');
const { matchCard } = require('./templates/match');
const { fixtures } = require('./data/fixtures');

function renderHome() {
  const cards = fixtures.map(matchCard).join('\n');
  return layout('Touchline Times', `<h1>This week's fixtures</h1>${cards}`);
}

function renderMatchPage(fixture) {
  return layout(`${fixture.home} v ${fixture.away}`, matchCard(fixture));
}

function renderNotFound() {
  return layout('Not found', '<p>That page does not exist.</p>');
}

module.exports = { renderHome, renderMatchPage, renderNotFound };
