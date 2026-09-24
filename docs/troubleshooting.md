# Troubleshooting

Start with the tab that is empty, work out which tier feeds it
([data-sources.md](data-sources.md)), then check that path. For anything on the agent host,
[agent-host/README.md](../agent-host/README.md#troubleshooting-ssm) has the SSM commands and a
symptom table.

## During apply

| Error | Cause and fix |
|---|---|
| `bedrock_models.<key> ... is not a system cross-region inference profile valid in <region>` | The profile prefix does not match the provider region. Use `eu.` profiles in `eu-*` regions, `us.` in `us-*`, and so on, or a `global.` profile. |
| `AccessDeniedException` creating `aws_bedrock_inference_profile` | Model access not granted, the Anthropic use-case form not approved, or an SCP denying Bedrock. See [prerequisites.md](prerequisites.md#bedrock-model-access). |
| Grafana `401` or `403` on a `grafana_cloud_*` resource or `data.grafana_cloud_stack` | The `grafana.cloud` token is missing a scope (`stacks:read`, `accesspolicies:*`) or its realm does not cover the stack. |
| Grafana `401` or `403` on `grafana_frontend_o11y_app` | `frontend_o11y_api_access_token` is unset or lacks the Frontend Observability scopes. Set it, or `frontend_observability_enabled = false`. |
| Grafana `403` on `grafana_agento11y_*` | The `grafana.stack` service account is not Admin, or Agent Observability is not enabled on the stack. |
| Rule group apply fails on `notification_settings` or `record` | Simplified routing or Grafana-managed recording rules are not available on the stack. See [prerequisites.md](prerequisites.md#alerting-features). |
| Rule or dashboard errors naming `grafanacloud-prom`, `grafanacloud-logs` or `grafanacloud-traces` | The module expects the stack's default provisioned datasources with those uids. They exist on every standard Grafana Cloud stack; a renamed or deleted one breaks the rules. |
| `grafana_asserts_prom_rule_file` fails | The Knowledge Graph is not initialized. Initialize it, or set `knowledge_graph_enabled = false`. |
| `aws_eks_pod_identity_association` fails | `cluster_name` is wrong, or the identity running apply cannot manage the cluster. |
| `agent_host_subnet_id is required` | Set a NAT-routed subnet, or `agent_host_enabled = false`. |
| `helm_release` times out | Pods not ready. `kubectl -n touchline get pods` and `describe` the failing one: an image pull error means the registry or tag in `images` is wrong or private; a crash loop in an agent usually means no AWS credentials (Pod Identity agent missing) or no Bedrock access. |
| Kubernetes provider `Unauthorized` or connection refused | Your AWS credentials cannot reach the cluster API: expired session, missing access entry, or a private endpoint you cannot route to. |

## After apply

| Symptom | Check |
|---|---|
| Agents dashboard empty | `kubectl -n touchline logs deploy/touchline-alloy`: export errors mean a bad OTLP Secret or token. `kubectl -n touchline get pods`: the load generator must be running and `traffic_enabled` true. |
| Agent logs show Bedrock `AccessDenied` | Pod Identity association missing (was the chart installed into a different namespace or service account?), or model access. The agents' role can call only this module's application inference profiles. |
| Agent logs show Bedrock `ThrottlingException` | Low tokens-per-minute quota in the account. Lower `site_requests_per_minute` or request a quota increase. |
| Per-team split on the agents dashboard shows one empty team | The `team` span-metrics dimension is not configured in Application Observability ([prerequisites.md](prerequisites.md#application-observability)). |
| Application Observability shows no services | It is not switched on for the stack, or you only just switched it on. |
| Frontend Observability empty | Page loads come from the synthetic-browser CronJob (every 10 minutes when `traffic_enabled`, chart value `siteBrowser.enabled`) or from you opening the site. `kubectl -n touchline get cronjob,jobs` shows whether it runs; its image is `site-browser`. |
| Knowledge Graph has no call edges | The rule needs service-graph metrics from traces; give it time after traffic starts. `gcx kg diagnose` helps if you use gcx. |
| Claude Code and gateway dashboards empty | Developers are not signed in. On the host: `sudo docker compose logs dev-alex-morgan`. Use `just login-developers` if the bot gave up. See [coding-agents.md](coding-agents.md). |
| Gateway audit log present, Claude Code OpenTelemetry tabs empty | The gateway's `forward_to` export is failing: `sudo docker compose logs gateway` on the host. |
| Gateway spend tab empty or datasource errors | `sudo docker compose logs pdc-agent postgres-grants` on the host. The datasource's connection test in Grafana should succeed once the PDC agent is connected. |
| Claude Code sessions end with `rc=124` or Bedrock errors in the audit log | Bedrock access for the agent host role, or throttling. |
| 429s in the gateway audit log | A spend cap was reached. Expected for the capped developer; see [coding-agents.md](coding-agents.md#spend-caps). |
| No LLM-judge scores | The Agent Observability judge provider is not configured for Bedrock, or its credentials cannot invoke the judge model. Regex and heuristic evaluators still score. |
| Guard alert never fires | PII probes are about one session in five, so give it an hour. Check the plugin is loaded (*OpenTelemetry: hooks, permissions and plugins* tab) and that guard calls are not timing out (a timeout fails open). |
| Bedrock *What Bedrock saw* tab empty | Expected unless `bedrock_invocation_logging_enabled = true`. |
| Bedrock *CloudWatch metrics* tab empty | Per-model series appear only after new invocations, a few minutes after they happen. If it stays empty, look at the `<prefix>-bedrock-metric-stream` Firehose in the AWS console: failed deliveries land in the fallback S3 bucket with the HTTP error. If the error is a wrong endpoint, set `grafana_aws_endpoints.metric_streams`. |
| Invocation logs not arriving (logging on) | Same check on the `<prefix>-bedrock-invocation-logs` Firehose; override with `grafana_aws_endpoints.firehose_logs` if the endpoint is wrong. |
| Recording-rule panels empty | Recording rules only start writing after the first evaluation, and series derived from logs need the log source to have data. Check the rule's health in Alerting > Alert rules. |
