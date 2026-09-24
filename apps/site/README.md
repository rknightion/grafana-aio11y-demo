# site

**Exposing this service publicly lets anyone spend your Bedrock money.** `POST /api/picks`
calls the orchestrator, which calls Bedrock, with no authentication and no rate limiting of
any kind. Every unauthenticated request that reaches this endpoint is a billable model
invocation on your AWS account. Keep it behind the demo's private networking (no public
ingress, no LoadBalancer Service) unless you have added your own auth and rate limiting in
front of it.

The Touchline Times reader site. Two images from one package:

- **site** (`Dockerfile`): the Node API. `GET /` serves the reader page with runtime config
  injected, `GET /app.js` the Faro-instrumented browser bundle, `POST /api/picks`
  `{question, userId, conversationId?, conversationTitle?}` forwards to the orchestrator and
  returns its answer plus `oddsCacheHit`. Odds questions check a five-minute Redis cache keyed by
  user and question, but the orchestrator is still called every time so each click keeps its full
  trace. HTTP, fetch and ioredis are auto-instrumented with OpenTelemetry.
- **site-browser** (`Dockerfile.browser`): one headless Chromium reader session per run, for a
  CronJob. The real browser loads the Faro bundle, so Frontend Observability gets page loads, web
  vitals and browser-to-backend traces with no human visitor.

## Environment

| Variable | Image | Meaning |
|---|---|---|
| `SERVICE_NAMESPACE` | both | Name prefix (default: `service.namespace` from `OTEL_RESOURCE_ATTRIBUTES`, else `touchline`) |
| `ORCHESTRATOR_URL` | site | Orchestrator base URL or full ask URL (default `http://<namespace>-orchestrator:8080`, `/v1/ask` appended) |
| `REDIS_URL` | site | Cache (default `redis://<namespace>-redis:6379`) |
| `FARO_URL` | site | Faro collector URL. Empty leaves browser instrumentation off |
| `FARO_APP_NAME`, `FARO_APP_VERSION`, `FARO_ENVIRONMENT` | site | Faro app metadata (defaults `<namespace>-site-web`, `v1`, `demo`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | site | Standard OTel (service name defaults to `<namespace>-site-api`) |
| `PORT` | site | Listen port (default `8080`) |
| `SITE_URL` | site-browser | Page to open (default `http://<namespace>-site-api:8080/`) |
| `BROWSER_MAX_START_DELAY_MS` | site-browser | Random start jitter ceiling (default 12 minutes, `0` disables) |
| `CONTENT_CAPTURE`, `AGENTO11Y_CONTENT_CAPTURE_MODE` | site-browser | When capture is off, logs answer length instead of answer text |

The Faro collector URL is public by design (it is embedded in every page), so it is passed as
plain runtime config, never baked into the image.

## Develop

```bash
npm ci
npm test          # builds the bundle, then runs the tests
```

## Images

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f apps/site/Dockerfile apps
docker buildx build --platform linux/amd64,linux/arm64 -f apps/site/Dockerfile.browser apps
```

Both run as the non-root `node` user. The browser image carries Chromium's headless shell, which
Playwright downloads for the build architecture.
