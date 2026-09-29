'use strict';

// Checks an offer's terms text for an 18+ marker and a responsible-gambling line. Used by
// scripts/check-offers.js and by legal's periodic audits.
function hasAgeMarker(text) {
  return /18\s*\+/.test(text) || /min_age/i.test(text);
}

// BUG: case-sensitive substring check. "Gambling can be addictive." should pass this (it's
// plainly an RG line) but doesn't, because we only match the lower-case word "gambling" here.
function hasResponsibleGamblingLine(text) {
  return text.includes('gambling') || text.includes('responsibly');
}

function checkOffer(offer) {
  return {
    id: offer.id,
    ageOk: hasAgeMarker(offer.terms) || offer.min_age === 18,
    rgOk: hasResponsibleGamblingLine(offer.terms),
  };
}

module.exports = { hasAgeMarker, hasResponsibleGamblingLine, checkOffer };
