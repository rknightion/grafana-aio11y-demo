# odds-feed

Ingests a raw bookmaker export (`fixtures-snapshot.json` locally; production reads from the
bookmaker polling worker) and normalises it into the shape the site and editorial tooling expect.

- `ingest.js` - reads the snapshot and normalises it
- `normalise.js` - raw rows -> `{ fixture: { outcome: { bookmaker: price } } }`
- `convert.js` - decimal/fractional/American price formatting
- `overround.js` - implied-probability margin per book

TODO: the American-odds helper in convert.js hasn't been checked against how the site actually
wants team-total lines formatted - ask trading before reusing it there.
