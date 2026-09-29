# Screenshots

What the demo looks like once it has been running with traffic on for a few hours. Every
screenshot comes from a live deployment of this repository: Grafana dark theme, the last three to
twenty-four hours, and only the fictional Touchline Times data the demo generates (its readers,
its five developers at `touchline.example`, its teams and its agents). The dashboards are the four
this module provisions; the other pages are Grafana Cloud apps reading the same telemetry.

For what to click and what to say in front of an audience, see the [Demo runbook](demo-runbook.md).
For which source feeds each tab, see [Data source tiers](data-sources.md).

## Agent Observability

The Grafana Cloud Agent Observability app, reading the generations, evaluations and guard results
that the in-app agents and the Claude Code plugin send it.

### Overview, agents and tools

![Agent Observability analytics page: total requests, error rate, evaluation pass rate, latency, estimated cost and tokens, with a cost warning and links into each area](assets/screenshots/gallery/agent-observability-analytics.webp)

The analytics landing page: requests, error rate, evaluation pass rate, latency, cost and tokens
at a glance, with what needs attention.

![Agent Observability agents list: generations per agent over three hours and a table of the Touchline agents with generations, error rate, p95 latency, tokens and cost](assets/screenshots/gallery/agent-observability-agents.webp)

The agents list: the five in-app Touchline agents and the Claude Code agent, with generations,
errors, latency, tokens and estimated cost for each.

![Agent Observability agent page for touchline-orchestrator: three prompt versions on a timeline, pass rate by evaluator and performance per version](assets/screenshots/gallery/agent-observability-agent-orchestrator.webp)

The orchestrator agent: three prompt versions, with pass rate by evaluator and tokens, latency and
error rate per version.

![Prompts tab of the touchline-orchestrator agent page showing the recorded system prompt for the match desk assistant](assets/screenshots/gallery/agent-observability-agent-orchestrator-prompt.webp)

The orchestrator's Prompts tab: the system prompt Agent Observability recorded for the current
version.

![Quality tab of the touchline-orchestrator agent page: pass rate per prompt version and two evaluators passing on the latest version](assets/screenshots/gallery/agent-observability-agent-orchestrator-quality.webp)

The orchestrator's Quality tab: evaluator pass rate per prompt version, with the latest version
marked as improved.

![Agent Observability agent page for claude-code/touchline: pass rate by evaluator, tokens, latency and error rate for the Claude Code agent](assets/screenshots/gallery/agent-observability-agent-claude-code.webp)

The Claude Code agent, fed by the Agent Observability plugin on the five developer containers.

![Tools tab of the claude-code/touchline agent page listing the built-in tools and MCP tools the developers' Claude Code sessions offered](assets/screenshots/gallery/agent-observability-agent-claude-code-tools.webp)

The Claude Code agent's tool inventory: built-in tools plus the MCP servers pushed by the gateway
and the developers' own.

![Agent Observability tools page: tool executions and errors over time and a table of tools such as get_odds, get_news, get_history and get_offers](assets/screenshots/gallery/agent-observability-tools.webp)

Tool performance across every agent: executions, error rate and p95 latency per tool.

### Conversations

![Agent Observability conversations list: conversation activity over three hours and recent reader conversations with agents, models and status](assets/screenshots/gallery/agent-observability-conversations.webp)

Every reader question to the match desk as a conversation, with the agents and models involved.

![One conversation in Agent Observability: the reader question, the news agent's tool call and answers, and the flow view grouping generations by agent](assets/screenshots/gallery/agent-observability-conversation-detail.webp)

One conversation opened: the reader's question, the news agent's `get_news` call and replies, and
the flow of generations by agent with tokens, cost and duration.

### Evaluations and guards

![Agent Observability evaluations page: three online evaluations with pass rate over time, matchers, evaluators, executions and cost](assets/screenshots/gallery/agent-observability-evaluations.webp)

The three online evaluations: answer quality and PII for the agents, content safety and PII for
Claude Code, and responsible-gambling language for the compliance agent.

![Agent Observability guards tab: eight request-path guards with type, priority, evaluators, activity, block rate and on-fail action, including a PII gate set to deny](assets/screenshots/gallery/agent-observability-guards.webp)

The guards: redaction and evaluator guards with their priorities, with the Claude Code PII gate
denying requests and the injected tool result guard warning.

### Experiments

![Agent Observability experiments overview: two completed runs of the match desk comparison suite with pass rate, cost and tokens](assets/screenshots/gallery/agent-observability-experiments.webp)

The scheduled experiments: completed runs of the match desk comparison suite, with trials, cost
and tokens.

## Agentic app dashboard

The in-app agents dashboard, built from OpenTelemetry GenAI metrics in Mimir, Tempo spans and
Agent Observability counters.

![Agentic app dashboard, overview tab: generations, tokens and site traffic per agent](assets/screenshots/dashboards-agents.png)

Overview: site API requests, agent generations, input and output tokens, and where the work
happens.

![Agentic app dashboard, request path tab: browser POSTs, site API requests and p95, agent calls by role and recent site-to-agent traces](assets/screenshots/gallery/dashboard-agents-request-path.webp)

Request path: from the browser and the site API through the agent chain, with links to recent
traces.

![Agentic app dashboard, cost and tokens tab: estimated model cost, cost per hour by agent and model, and tokens by agent, model and type](assets/screenshots/gallery/dashboard-agents-cost-tokens.webp)

Cost and tokens: estimated model cost split by agent and model, the token mix, and orchestrator
cost per prompt version.

![Agentic app dashboard, latency and tools tab: generation p95 by agent, tool p95 by agent and tool executions by role and tool](assets/screenshots/gallery/dashboard-agents-latency-tools.webp)

Latency and tools: generation and tool latency by agent, and which tools each agent calls.

![Agentic app dashboard, evaluations and guards tab: quality scores by agent and outcome, and server guard actions by outcome](assets/screenshots/gallery/dashboard-agents-evals-guards.webp)

Evaluations and guards: online quality scores by agent and outcome, and guard actions on tool
results.

![Agentic app dashboard, traces tab: recent site request traces, agent traces with conversation ids, and conversations with model and token counts](assets/screenshots/gallery/dashboard-agents-traces.webp)

Traces: recent site and agent traces, each row linking to Tempo and to its Agent Observability
conversation.

![Agent service graph edges per hour, stacked by edge from the load generator and site through the orchestrator to each specialist agent](assets/screenshots/gallery/dashboard-agents-service-edges-panel.webp)

Service graph edges: calls per hour from the site to the orchestrator and on to each specialist
agent.

## Claude Code dashboard

The Claude Code dashboard, built from Claude Code's own OpenTelemetry metrics, logs and traces,
which the gateway's managed settings switch on.

![Claude Code dashboard, OpenTelemetry overview tab: spend, sessions and tokens per developer and team](assets/screenshots/dashboards-claude-code.png)

OpenTelemetry overview: spend, sessions, tokens and active time per developer and team.

![Claude Code dashboard, cost and tokens tab: input, output and cache tokens, cache hit rate, weighted spend by token class and tokens by developer](assets/screenshots/gallery/dashboard-claude-code-cost-tokens.webp)

Cost and tokens: the token mix, how much the cache saves, and spend by model and developer.

![Claude Code dashboard, prompts and sessions tab: a conversation transcript with tool calls and responses, and tables of recent prompts and responses by session](assets/screenshots/gallery/dashboard-claude-code-prompts-sessions.webp)

Prompts and sessions: one developer session read back as a transcript, with the prompts and
responses around it.

![Claude Code dashboard, MCP servers and tools tab: MCP tool calls by server over time and the MCP servers connected by scope and transport](assets/screenshots/gallery/dashboard-claude-code-mcp-servers.webp)

MCP servers and tools: tool calls per MCP server, and which servers the gateway manages versus
the developers' own.

![MCP attribution table: spend, tokens and sessions for each MCP server and tool](assets/screenshots/gallery/dashboard-claude-code-mcp-attribution-panel.webp)

MCP attribution: spend, tokens and sessions for each MCP server and tool.

![Claude Code dashboard, hooks, permissions and plugins tab: hook runs, blocking decisions, permission decisions, hook latency and hook runs by event](assets/screenshots/gallery/dashboard-claude-code-hooks-permissions.webp)

Hooks, permissions and plugins: hook runs and latency, permission decisions and the plugins
loaded.

![Claude Code dashboard, Agent Observability plugin tab: generation cost by agent and model, Cloud guard outcomes, guard denies and online evaluation scores](assets/screenshots/gallery/dashboard-claude-code-agent-observability-plugin.webp)

Agent Observability plugin: generation cost, Cloud guard outcomes and online evaluation scores for
Claude Code.

![Cloud guard outcomes per rule for the Claude Code guards, including the PII gate deny series](assets/screenshots/gallery/dashboard-claude-code-cloud-guard-outcomes-panel.webp)

Cloud guard outcomes per rule, with the PII gate denies alongside the passes.

![Claude Code dashboard, traces tab: interactions, turn latency, time to first token, recent turns by developer and LLM requests by stop reason](assets/screenshots/gallery/dashboard-claude-code-traces.webp)

Traces: each Claude Code turn as a trace, with turn latency, time to first token and the
developer who asked.

![Claude Code dashboard, Bedrock invocation log tab: Bedrock calls from the gateway, tokens, traffic by model and calls by API operation and region](assets/screenshots/gallery/dashboard-claude-code-bedrock-gateway-caller.webp)

Bedrock invocation log, gateway caller: the same traffic from Bedrock's side, where every
developer is the gateway's one IAM identity.

## Claude apps gateway dashboard

The gateway dashboard, built from the gateway's audit log in Loki, its Postgres spend store over
Private Data Source Connect, and recording rules over both.

![Claude apps gateway dashboard, audit log tab: sign-ins, inference requests and managed settings](assets/screenshots/dashboards-gateway.png)

Audit log: sign-ins, inference requests and managed settings served, per developer and model.

![Claude apps gateway dashboard, spend store tab: spend today, this week and this month, spend per developer and team, and spend caps against actual spend](assets/screenshots/gallery/dashboard-gateway-spend-store.webp)

Spend store: the gateway's own spend ledger per developer and team, and each spend cap against
what has been spent.

![Claude apps gateway dashboard, derived metrics tab: inference requests by model and by developer, requests by status, error ratio and latency p95](assets/screenshots/gallery/dashboard-gateway-recording-rules.webp)

Derived metrics: `touchline_gateway_*` recording rules, so a gateway with no metrics endpoint can
still be graphed and alerted on.

![Claude apps gateway dashboard, operational logs tab: log lines by source, gateway warnings and the gateway's operational log](assets/screenshots/gallery/dashboard-gateway-operational-logs.webp)

Operational logs: the gateway's own warn and info lines and the other agent host containers.

![Claude apps gateway dashboard, alerts tab: the demo's Bedrock latency and server error alert rules with their instances](assets/screenshots/gallery/dashboard-gateway-alerts.webp)

Alerts: the demo alert rules and their current state.

![Claude apps gateway dashboard, what the gateway emits tab: a table of each signal the gateway produces, where it lands and which tab shows it](assets/screenshots/gallery/dashboard-gateway-what-it-emits.webp)

What the gateway emits: every signal the gateway produces on its own, and what it cannot see.

## Bedrock dashboard

The Bedrock dashboard, built from the `AWS/Bedrock` CloudWatch metric stream and the optional
model invocation log.

![Bedrock dashboard, CloudWatch metrics tab: invocations, tokens and latency per inference profile](assets/screenshots/dashboards-bedrock.png)

CloudWatch metrics: invocations, tokens, latency and quota usage per inference profile, AWS's own
counters.

![Bedrock dashboard, what Bedrock saw tab: invocations, input and output tokens, model latency, and calls, tokens and latency by team and model](assets/screenshots/gallery/dashboard-bedrock-what-bedrock-saw.webp)

What Bedrock saw: the invocation log, split by team and model through the per-team application
inference profiles.

![Bedrock dashboard, app OpenTelemetry versus Bedrock log tab: generations the app recorded per agent next to rows Bedrock logged](assets/screenshots/gallery/dashboard-bedrock-app-vs-bedrock-log.webp)

App OpenTelemetry versus Bedrock log: the application's count of generations next to Bedrock's,
two views of the same calls.

## Application Observability and Knowledge Graph

The same agent spans seen as services, with no extra instrumentation.

![Application Observability services list: the Touchline services with namespace, technology, p95 duration, errors and rate](assets/screenshots/gallery/app-observability-services.webp)

Application Observability services: every Touchline service with its duration, errors and rate.

![Application Observability service overview for touchline-orchestrator: duration, errors and rate, and inbound calls from the site API](assets/screenshots/gallery/app-observability-orchestrator-overview.webp)

The orchestrator as a service: RED metrics and its inbound calls from the site API.

![Knowledge Graph entity graph of the Touchline services and the calls between them](assets/screenshots/gallery/knowledge-graph-entity-graph.webp)

Knowledge Graph: the Touchline services and the call edges between them.

![Knowledge Graph entity catalog: the Touchline services with technology, p95 latency, error ratio and request rate](assets/screenshots/gallery/knowledge-graph-entity-catalog.webp)

Entity catalog: the same services with latency, error ratio and request rate.
