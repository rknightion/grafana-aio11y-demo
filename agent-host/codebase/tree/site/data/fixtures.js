'use strict';

// Small static list for the home page. The real prices come from odds-feed at build time; this
// file only carries what the templates need to lay a card out. Keep team names in sync with
// odds-feed/fixtures-snapshot.json if you add one here.
const fixtures = [
  { home: 'Harbour City', away: 'Northgate Rovers', competition: 'Premier Division', kickoff: 'Sat 15:00' },
  { home: 'Kingsbridge United', away: 'Ashford Athletic', competition: 'Premier Division', kickoff: 'Sun 14:00' },
  { home: 'Redvale', away: 'Fellgate Wanderers', competition: 'Northern Cup', kickoff: 'Tue 19:45' },
];

module.exports = { fixtures };
