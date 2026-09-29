'use strict';

// Decimal <-> fractional <-> American conversions. Decimal is what odds-feed stores everywhere
// else; fractional and American are for the print-style and US-facing pages.

function formatDecimal(price) {
  return price.toFixed(2);
}

function toAmerican(price) {
  if (price >= 2) return `+${Math.round((price - 1) * 100)}`;
  return `${Math.round(-100 / (price - 1))}`;
}

// BUG: builds an approximate fraction out of the first two decimal digits and never reduces it,
// so 2.30 comes back as "130/100" instead of "13/10" (or the "6/4" style price a sub-editor would
// actually write). Nothing in odds-feed/test/convert.test.js exercises this yet.
function toFractionString(price) {
  const numerator = Math.round((price - 1) * 100);
  return `${numerator}/100`;
}

module.exports = { formatDecimal, toAmerican, toFractionString };
