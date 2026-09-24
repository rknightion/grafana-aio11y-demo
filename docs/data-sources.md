# Data sources: what each tier sees

The demo is built so you can show the same activity from several vantage points and be honest
about what each one can and cannot tell you. Every dashboard tab is labelled by the source behind
it, and each dashboard ends with a "Where the data comes from" or "What the gateway emits" tab
that spells it out.

## The tiers

| Tier | What produces it | Where it lands |
|---|---|---|
| 1. Gateway only | the Claude apps gateway's audit log and its own Postgres spend store | Loki (`service_name=touchline-gateway`), Postgres datasource `touchline-gateway-spend` over PDC, `touchline_gateway_*` recording rules |
| 2. Claude Code native OpenTelemetry | Claude Code itself, with settings the gateway pushes | Mimir (metrics), Loki (events with content), Tempo (traces) |
| 3. Agent Observability plugin | the agento11y Claude Code plugin, enabled by the gateway policy | Agent Observability (conversations, guards, evaluations), guard outcome metrics in Mimir, plugin spans in Tempo |
| 4. Bedrock-side | CloudWatch metric stream, and optional model invocation logging | Mimir (`aws_bedrock_*`), Loki (`service_name=touchline-bedrock-invocations`) |
| 5. In-app agents | OpenTelemetry SDKs and the agento11y SDK in the Touchline apps, Faro in the browser | Mimir, Loki, Tempo, Agent Observability, Frontend Observability, Application Observability, Knowledge Graph |

## What each tier can answer

| Question | Gateway only | + native OTel | + plugin | Bedrock-side | In-app agents |
|---|---|---|---|---|---|
| Who made the call | yes, IdP email and groups | yes, `user.email`, `user.groups` | yes | no: one IAM role per caller; team and model from the application inference profile, agent from the Pod Identity session name | yes, agent name and team |
| Which model | yes | yes | yes | yes, per inference profile | yes |
| Tokens and cost | gateway's USD estimate per developer and period, enforced against caps | Claude Code's own cost and token counters | per generation and subagent | tokens per model (no price) | per generation, estimated from list prices |
| Prompt and response text | never | yes, when `content_capture` is on | yes | yes, when invocation logging is on (runtime API only) | yes, when `content_capture` is on |
| Tool and MCP calls | no, they never pass through the gateway | yes, with real MCP server and tool names | yes, as tool executions | no | yes |
| Guards (deny, redact, warn) | no | hook runs appear as events | yes, outcomes per rule | no | yes, tool-result injection guard |
| Evaluation scores | no | no | yes, online evaluations | no | yes, online evaluations and experiments |
| Latency | yes, end to end through the gateway | yes, per request | yes | yes, Bedrock-side | yes, per span |
| Where the call was served | no | no | no | yes, the region a cross-region profile routed to | no |

Two points worth making out loud when you present:

- **The gateway sees who and how much, not what.** It knows every sign-in, every model call, its
  status, latency and cost, and it can push MCP servers to clients. It cannot see tool calls, MCP
  calls, file edits or anything inside a session. Those come from Claude Code's own telemetry.
- **Bedrock sees content and tokens, not people.** Every in-app agent shares one IAM role and
  every developer arrives as the agent host's role. The per-team application inference profiles
  are what make AWS-side attribution possible. Invocation logging also covers only the
  `bedrock-runtime` API; calls through other Bedrock endpoints appear in the app's telemetry and
  not in the log, which the Bedrock dashboard shows side by side.

## Dashboard tabs by tier

### Observing Claude Code (`touchline-claude-code`)

| Tab | Tier |
|---|---|
| Gateway audit log (no endpoint telemetry) | 1 |
| Gateway spend (Postgres) | 1 |
| Bedrock invocation log: gateway caller | 4 (empty unless invocation logging is on) |
| OpenTelemetry: overview | 2 |
| OpenTelemetry: cost and tokens | 2 |
| OpenTelemetry: MCP servers and tools | 2 |
| OpenTelemetry: prompts and sessions | 2 (content needs `content_capture`) |
| OpenTelemetry: hooks, permissions and plugins | 2, showing the plugin's hooks |
| OpenTelemetry: traces | 2 and 3 |
| OpenTelemetry + Agent Observability plugin | 3 |
| Where the data comes from | reference |

### Observing the Claude apps gateway (`touchline-gateway`)

Tier 1 only, on purpose: Audit log, Spend store (Postgres), Derived metrics (recording rules),
Operational logs, Alerts, What the gateway emits. The gateway exposes no Prometheus endpoint and
no traces of its own, so everything here is its audit log, its database and rules derived from
them.

### Observing Bedrock (`touchline-bedrock`)

| Tab | Tier |
|---|---|
| What Bedrock saw | 4, invocation log (empty unless enabled) |
| App OpenTelemetry vs Bedrock log | 5 next to 4, the same calls from both sides |
| CloudWatch metrics | 4, metric stream |

### Observing an agentic app (`touchline-agents`)

Tier 5: Overview, Request path, Cost & tokens, Latency & tools, Evals & guards, Traces, Where the
data comes from. Outside the dashboard, the same data drives Agent Observability (Agents >
`touchline-orchestrator`), Application Observability (service inventory and map for the
`touchline` namespace), Frontend Observability (app `touchline-site-web`) and the Knowledge Graph.

## Scoping

Every query is scoped to the demo so other users of the same stack never appear: Claude Code by
`service_name="claude-code"` and `service_namespace="touchline"`, the agents by their service
names, the gateway and host by `service_namespace`, Agent Observability rules by the `touchline_`
id prefix, and Bedrock log panels by the Firehose's static labels. The CloudWatch panels are the
exception: the metric stream carries every `AWS/Bedrock` metric in the account and region, keyed
by model or inference profile id.
