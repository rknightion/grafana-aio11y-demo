# mcp-tools

Four deterministic, offline tools over fictional fixture data for Touchline Times, served over
stdio MCP. Claude Code calls them as an MCP server; the in-app agents import the same module
(`@touchline/mcp-tools/tools`), so both paths share one implementation and one data set.

| Tool | Arguments | Returns |
|---|---|---|
| `get_odds` | `fixture_id?`, `team?` | Prices from three fictional bookmakers plus the best price per outcome; no arguments lists the fixtures |
| `get_news` | `team` | Recent short news items |
| `get_history` | `home`, `away` | Last five head-to-head results, either orientation |
| `get_offers` | `market?` (`football`, `basketball`, `general`) | Offers, each with terms, `min_age: 18` and a responsible-gambling line |

Unknown teams, fixtures or markets come back as `{ "error": "..." }` results, never exceptions.
Every club, competition, venue, bookmaker and offer in `src/data/` is invented. The module reads
no clock and makes no network calls, so demos are reproducible.

`src/tools.mjs` must not import the MCP SDK: it is the shared seam, and the agents image uses it
without the SDK. `marketForText()` is exported for the agents to keep offers relevant.

## Environment

| Variable | Meaning |
|---|---|
| `MCP_SERVER_NAME` | Server name in the MCP initialize response (default `SERVICE_NAMESPACE`, else `touchline`). Keep it equal to the name the server is registered under, which is what Claude Code records as `mcp_server.name` |

## Run

```bash
npm ci && npm test
npm start                                   # stdio; protocol on stdout, logs on stderr
claude mcp add touchline -- node "$PWD/src/server.mjs"
```

## Image

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f apps/mcp-tools/Dockerfile apps
docker run --rm -i <image>                  # stdio MCP server
```

Other images can take the server with `COPY --from=<image> /app /opt/touchline-mcp-tools` and run
`node /opt/touchline-mcp-tools/src/server.mjs`.
