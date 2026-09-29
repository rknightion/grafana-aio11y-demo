# Touchline Times engineering monorepo

Internal tools behind touchlinetimes.example (fictional sports paper): the match-page site, the
odds feed that normalises bookmaker prices, the offers/compliance checks, and the editorial
tooling that drafts match previews.

## Layout

- `site/` - the match-page server: routing, templates and rendering (owned by platform, templates
  by newsroom)
- `odds-feed/` - ingest and normalise bookmaker prices; decimal/fractional/American conversion
  (owned by trading)
- `offers/` - offer terms and the 18+ / responsible-gambling wording checks (owned by trading)
- `editorial/` - style guide, preview template and the preview-drafting CLI (owned by newsroom)
- `scripts/` - small one-off checks that don't belong in any one module
- `docs/` - runbooks

## Running things

Plain Node, no dependencies. `node --test` discovers every `*.test.js` file.

```
node --test                      # whole repo
node --test site/test            # one module
node editorial/cli.js "Harbour City" "Northgate Rovers"
node scripts/check-offers.js
```

See CODEOWNERS for who to ask about what.
