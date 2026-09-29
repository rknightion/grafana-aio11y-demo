'use strict';

// Overround (the book's built-in margin) is the sum of the implied probabilities (1/price) for
// every outcome, minus 1. A 1.00 book (100%) is exactly fair; anything above is the vig.
function overround(prices) {
  const implied = Object.values(prices).map((p) => 1 / p);
  return implied.reduce((sum, p) => sum + p, 0) - 1;
}

module.exports = { overround };
