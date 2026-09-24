# agents

The Touchline Times match desk: five in-app AI agents on Amazon Bedrock, plus the synthetic
reader load generator and the Agent Observability experiment runner. One image runs all of them.

- **orchestrator** routes a reader question to the specialists it needs, then writes the final
  answer from their guarded findings (`POST /v1/ask`).
- **news**, **odds**, **editorial**, **compliance** are specialists (`POST /v1/agent`). News, odds
  and compliance call the shared tools from [`../mcp-tools`](../mcp-tools) (the same
  implementation Claude Code reaches over MCP). Compliance always appends an 18+ and
  responsible-gambling line.
- **loadgen** posts jittered reader questions to the site API, a small share of them carrying an
  injected "Tool note" that the news tool replays as untrusted content, which is what the
  prompt-injection guard should flag.
- **experiments** (`node experiments/run-experiment.mjs`) compares orchestrator models or prompt
  variants as Agent Observability experiments, scored by the stack's answer-quality evaluator.

Every model call is a Bedrock generation recorded with the agento11y SDK (conversation, parent
generation links, tool executions, token usage), every tool result passes the stack's preflight
guards, and OpenTelemetry traces and metrics go to the in-namespace Alloy. The orchestrator rotates
three prompt variants on a deterministic 2-3 hour schedule so version comparisons appear without
operator action.

## Environment

| Variable | Used by | Meaning |
|---|---|---|
| `AGENT_ROLE` or `ROLE` | all | `orchestrator`, `news`, `odds`, `editorial`, `compliance` or `loadgen` |
| `SERVICE_NAMESPACE` | all | Name prefix and `service.namespace` (default: `service.namespace` from `OTEL_RESOURCE_ATTRIBUTES`, else `touchline`) |
| `AGENT_TEAM` | agents | Owning team, recorded as span attribute `team` and generation metadata (defaults: orchestrator and compliance `platform`, news and editorial `newsroom`, odds `trading`) |
| `AGENT_VERSION` | agents | Agent version (default `v1`); variant versions are `<AGENT_VERSION>-<variant>-<hash>` |
| `AWS_REGION` | agents | Bedrock region; credentials come from the default chain (EKS Pod Identity in the cluster) |
| `MODEL_PROFILE_ARN` | agents | Bedrock application inference profile ARN for this agent's team |
| `MODEL_KEY` | agents | Model key for usage rows and `x-agent-model` (default `default`) |
| `MODEL_NAME` | agents | Recorded model name; a Bedrock id such as `eu.anthropic.claude-haiku-4-5-20251001-v1:0` is normalised to `claude-haiku-4-5` (default `MODEL_KEY`) |
| `MODEL_PROFILES` | orchestrator | Optional JSON `{"<key>": {"arn": "...", "name": "..."}}` enabling per-request model overrides for model-comparison experiments |
| `BEDROCK_API`, `MANTLE_MODEL` | agents | `mantle` sends that agent through the Anthropic Messages API on Bedrock with base model `MANTLE_MODEL` (default `converse`) |
| `CONTENT_CAPTURE` | all | `true` (default) records prompts, responses and tool content; `false` records metadata only |
| `AGENTO11Y_CONTENT_CAPTURE_MODE` | all | Overrides `CONTENT_CAPTURE` with an SDK mode (`full`, `metadata_only`, ...; `none` means `metadata_only`) |
| `AGENTO11Y_ENDPOINT`, `AGENTO11Y_AUTH_TENANT_ID`, `AGENTO11Y_AUTH_TOKEN` | all | Agent Observability ingest (token needs `sigil:write`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (and the other standard `OTEL_EXPORTER_OTLP_*`) | all | OTLP/HTTP endpoint, the in-namespace Alloy |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | all | Standard; the service name is also the agent name (`gen_ai.agent.name`) |
| `SPECIALIST_URL_TEMPLATE` | orchestrator | Specialist URL, `{name}` and `{role}` placeholders (default `http://{name}:8080/v1/agent`) |
| `VARIANT_MODE` | orchestrator | `rotate` (default) or a variant id to pin |
| `FAULT_RATE` | specialists | Share of tool calls that fail with a simulated timeout (default `0.02`) |
| `PORT` | agents | Listen port (default `8080`) |
| `STUB_MODEL=1` | all | Local runs without Bedrock or Grafana Cloud |
| `SITE_URL` | loadgen | Site base URL; `/api/picks` is appended when it has no path (`SITE_API_URL` takes a full URL) |
| `LOADGEN_SETTINGS_FILE` | loadgen | JSON settings, re-read every tick (default `/etc/<namespace>-loadgen/rate.json`): `requestsPerMinute`, `dailyBudgetUsd`, `enabled` |
| `LOADGEN_REQUESTS_PER_MINUTE`, `LOADGEN_DAILY_BUDGET_USD`, `LOADGEN_ENABLED` | loadgen | Fallbacks for keys the file does not set (defaults 2, 15 capped at 30, true) |
| `LOADGEN_STATE_DIR` | loadgen | Where the daily spend ledger lives (default `/var/lib/loadgen`, writable) |

The experiment runner reads `AGENTO11Y_ENABLE_EXPERIMENTAL_FEATURES=true` (required by the SDK),
optional `AGENTO11Y_GRAFANA_URL` + `AGENTO11Y_SERVICE_ACCOUNT_TOKEN` (to publish the stored test
suite if it is missing), `ORCHESTRATOR_BASE_URL` or `ORCHESTRATOR_URL`, `EXPERIMENTS_SET`,
`EXPERIMENTS_DELAY_MS`, `EXPERIMENTS_PROBABILITY`, `EXPERIMENTS_DAILY_RUN_CAP`,
`EXPERIMENTS_EVALUATOR_ID` and `EXPERIMENTS_EVALUATOR_VERSION`. The suite lives in
[`config/experiment-suite.yaml`](config/experiment-suite.yaml); `--help` lists the flags. Scheduled
mode needs RBAC to get, create and update a Lease in its namespace.

## Develop

```bash
npm ci            # also links ../mcp-tools
npm test
STUB_MODEL=1 AGENT_ROLE=news npm start
```

## Image

Build context is `apps/` because the agents import `../mcp-tools`:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f apps/agents/Dockerfile apps
```

The image runs as the non-root `node` user. Default command starts the agent named by
`AGENT_ROLE`/`ROLE`; override it with `node experiments/run-experiment.mjs --scheduled --execute`
for the experiment CronJob.
