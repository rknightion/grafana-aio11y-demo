# Platform runbook (site + agent-host dev environment)

## Site

`node site/server.js` - listens on `PORT` (default 3000). No build step; templates are plain JS
template functions. See site/router.js for the FIXME on path-param routes before adding a
per-fixture page.

## Local checks

```
node --test                # everything
node scripts/check-offers.js
node editorial/cli.js "Harbour City" "Northgate Rovers"
```

## Known gaps (also see CODEOWNERS)

- odds-feed's fractional-odds converter (`odds-feed/convert.js`) has no test coverage and its
  output looks wrong for anything above evens.
- The offers RG-line check (`offers/rgCheck.js`) has a case-sensitivity bug; see the failing test
  in offers/test/rgCheck.test.js.
- The site router only matches literal paths - no `/match/:id`.
