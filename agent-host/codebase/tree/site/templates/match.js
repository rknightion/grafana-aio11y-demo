'use strict';

function matchCard(fixture) {
  return `<article class="match-card">
  <h2>${fixture.home} v ${fixture.away}</h2>
  <p>${fixture.competition} - kicks off ${fixture.kickoff}</p>
</article>`;
}

module.exports = { matchCard };
