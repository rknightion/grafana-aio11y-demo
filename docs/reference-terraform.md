---
title: Terraform reference
description: Every input variable and output of the grafana-aio11y-demo Terraform module.
---

# Terraform reference

The module interface in `terraform/variables.tf` and `terraform/outputs.tf`. Frozen: a rename
here would need every consumer (docs, examples, the chart) updated in the same change.

## Inputs

### Identity

| Variable | Type | Default | Description |
|---|---|---|---|
| `name` | string | `"touchline"` | Prefix for every AWS, Kubernetes and Grafana object this module creates. Must be unique per AWS account and per Grafana stack: two deployments with the same name collide on account-global IAM roles, Secrets Manager paths and the stack's prefixed Grafana objects (dashboards, rules, evaluators), and one apply or destroy then changes the other's resources. Must match `^[a-z][a-z0-9-]{1,20}$`. |
| `tags` | map(string) | `{}` | Tags applied to every AWS resource. |

### Where it runs

| Variable | Type | Default | Description |
|---|---|---|---|
| `cluster_name` | string | *(required)* | Name of the existing EKS cluster the Kubernetes and Helm providers point at. Used only for EKS Pod Identity associations; the cluster needs the `eks-pod-identity-agent` add-on (built in on Auto Mode). |
| `namespace` | string | `"touchline"` | Kubernetes namespace for the in-app agents and site. Created and owned by this module. |
| `deploy_workloads` | bool | `true` | Install the Helm chart with `helm_release`. Set `false` to deploy `charts/touchline` yourself with Argo CD, Flux or kubectl; the module still creates the namespace, Secrets, IAM and Grafana objects and outputs the chart values. |
| `agent_host_enabled` | bool | `true` | Create the EC2 agent host that runs the Claude apps gateway and the developer containers. |
| `agent_host_subnet_id` | string | `null` | Subnet for the agent host. It needs outbound internet (NAT or equivalent) for SSM, container images, the Claude Code download, Bedrock and Grafana Cloud. Required when `agent_host_enabled`. |
| `agent_host_instance_type` | string | `"t4g.xlarge"` | Agent host instance type. The AMI architecture follows it (Graviton types use arm64). |

### Grafana Cloud

| Variable | Type | Default | Description |
|---|---|---|---|
| `grafana_cloud_stack_slug` | string | *(required)* | Slug of the Grafana Cloud stack that receives all telemetry and holds the dashboards, rules and Agent Observability objects. The `grafana.cloud` provider alias must hold a Cloud access policy token that can manage access policies, PDC and the stack; `grafana.stack` must point at this stack with an Admin service account token. |
| `alert_contact_point` | object({ name = string }) | `null` | Where the demo alerts route. `null` creates a contact point that delivers nowhere (a webhook to a blackhole address), so the alerts fire visibly without paging anyone. |

### Bedrock

| Variable | Type | Default | Description |
|---|---|---|---|
| `bedrock_models` | map(string) | `{ haiku = "eu.anthropic.claude-haiku-4-5-20251001-v1:0", sonnet = "eu.anthropic.claude-sonnet-4-6" }` | Model key to system cross-region inference profile id, copied per team. The profile prefix (`eu.`, `us.`, `apac.`, `global.`) must be valid for the provider region. Model access and Anthropic's one-time use-case form must already be done in the account. |
| `agent_models` | map(string) | `{ orchestrator = "sonnet", news = "haiku", odds = "haiku", editorial = "sonnet", compliance = "haiku" }` | Which `bedrock_models` key each in-app agent uses. |
| `judge_model` | string | `"haiku"` | `bedrock_models` key used by the Agent Observability LLM-judge evaluators. |
| `bedrock_invocation_logging_enabled` | bool | `false` | Turn on Bedrock model invocation logging and ship it to Grafana Cloud Logs. Account- and region-wide, captures prompt and completion text for every Bedrock call in the region (not just this demo), replaces any existing configuration, and destroy removes it rather than restoring a previous one. Enable in a dedicated sandbox account. |
| `bedrock_metric_stream_enabled` | bool | `true` | Stream the `AWS/Bedrock` CloudWatch namespace to Grafana Cloud Metrics with a CloudWatch metric stream and Firehose. |
| `grafana_aws_endpoints` | object({ metric_streams = optional(string), firehose_logs = optional(string) }) | `{}` | Override the Grafana Cloud AWS ingest endpoints if derivation from the stack is wrong for your region. |

### Developers, teams and the gateway

| Variable | Type | Default | Description |
|---|---|---|---|
| `teams` | list(string) | `["newsroom", "trading", "platform"]` | Team names. Each becomes a Cognito group (gateway policies, per-group spend caps, `user.groups` in telemetry) and a set of per-team Bedrock application inference profiles. |
| `developers` | list(object({ name = string, team = string })) | 5 developers across the 3 default teams (see [Coding agents and the gateway](coding-agents.md#developers-and-teams)) | Claude Code developers signed in through the gateway, one container each on the agent host. `name` is a stable key (letters, digits, dots). |
| `developer_email_domain` | string | `"touchline.example"` | Email domain for the generated developer identities. |
| `team_model_allowlist` | map(list(string)) | `{ trading = ["haiku"] }` | Per-team restriction of `gateway_models` for the developers. Teams not listed get every gateway model. |
| `gateway_models` | list(string) | `["haiku", "sonnet"]` | `bedrock_models` keys the gateway offers to developers. |
| `spend_caps` | object({ organization = optional(map(number)), groups = optional(map(map(number))), users = optional(map(map(number))) }) | `{}` (module defaults to `organization = { daily = 20 }`, `groups = { trading = { daily = 5 } }`, `users = { "casey.nguyen" = { daily = 2 } }`) | Gateway spend caps in whole USD. `user` keys are developer names, `group` keys are team names. Caps are per-seat defaults, most restrictive wins. |
| `content_capture` | bool | `true` | Capture prompt text, assistant responses and tool content in telemetry (Claude Code `OTEL_LOG_*` settings pushed by the gateway, and the in-app agents). Needed for the prompt-level panels and content evaluators. Treat captured telemetry as sensitive. |

### Traffic and cost

| Variable | Type | Default | Description |
|---|---|---|---|
| `traffic_enabled` | bool | `true` | Master switch for all synthetic traffic: developer sessions, the site load generator and the experiment schedule. `false` leaves everything deployed but idle. |
| `developer_session_interval_minutes` | number | `20` | Mean minutes between Claude Code sessions per developer (jittered). |
| `site_requests_per_minute` | number | `2` | Load generator rate against the site (each request fans out to Bedrock). |

### Versions and images

| Variable | Type | Default | Description |
|---|---|---|---|
| `claude_code_version` | string | `"2.1.281"` | Claude Code release installed at container start on the agent host (gateway and developers). Never baked into images. The login bot is tested against this version. |
| `agento11y_cli_version` | string | `"latest"` | agento11y CLI and Claude Code plugin version for the developer containers. `latest` keeps the build pinned in the dev-workstation image and a version installs that release; either way the plugin marketplace is pinned to the matching tag. |
| `images` | object({ registry = optional(string), name_prefix = optional(string), tag = optional(string), digests = optional(map(string)), pull_secret = optional(string) }) | `{ registry = "ghcr.io/rknightion", name_prefix = "grafana-aio11y-demo-", tag = "0.1.0", digests = {} }` | Container image registry, name prefix and tag for this repo's images. Every image reference is `<registry>/<name_prefix><app>:<tag>`. `tag` is a plain tag and defaults to this module's release; `digests` (image name to `sha256:...`) pins individual images immutably; verify an image with cosign before pinning it (see [Security](security.md)). Override `registry` to use a private mirror; set `name_prefix = ""` for a mirror whose repositories are already `<registry>/<app>`. <!-- x-release-please-version --> |

### Site

| Variable | Type | Default | Description |
|---|---|---|---|
| `frontend_observability_enabled` | bool | `true` | Create a Grafana Frontend Observability app and instrument the site's browser code with Faro. |
| `site_ingress` | object({ class_name = string, host = string, annotations = optional(map(string)) }) | `null` | Expose the site through an Ingress. `null` keeps it ClusterIP only (reach it with `kubectl port-forward`). |

### Stack-wide Grafana products

| Variable | Type | Default | Description |
|---|---|---|---|
| `manage_app_observability` | bool | `false` | Let this module switch Application Observability on. Stack-wide singleton: destroy switches the product off for the whole stack, so leave `false` on a shared stack where it is already on. |
| `manage_knowledge_graph` | bool | `false` | Let this module perform Knowledge Graph (Asserts) onboarding, using its own Cloud access policy token and stack Admin service account token, which exist only while this is `true`. Stack-wide singleton: destroy calls the same API the onboarding wizard's disable control uses, switching Knowledge Graph off for the whole stack, so leave `false` on a shared stack where it is already on. |
| `knowledge_graph_enabled` | bool | `true` | Create the Knowledge Graph service-graph rule and this demo's own trace configuration (entity properties for its services, scoped to `var.namespace`, at a low priority so it never overrides another config on a shared stack). The Knowledge Graph must already be initialized on the stack, either by `manage_knowledge_graph` or by hand. |

## Outputs

| Output | Sensitive | Description |
|---|---|---|
| `dashboards` | no | Grafana dashboard URLs. |
| `agent_host_instance_id` | no | EC2 instance id of the agent host (use with `aws ssm start-session`). |
| `gateway_url` | no | Gateway URL as the developer containers see it. From your laptop use `just gateway-tunnel` and `https://localhost:8443`. |
| `cognito_user_pool_id` | no | Cognito user pool holding the demo developers. |
| `developers` | no | Developer usernames by team. |
| `developer_passwords` | yes | Generated Cognito passwords, for signing in by hand if the login bot fails. |
| `gateway_admin_read_key` | yes | Gateway admin read key for the spend API and admin UI over the tunnel. |
| `agents_role_arn` | no | IAM role the in-app agents assume through EKS Pod Identity. |
| `bedrock_team_profiles` | no | Per-team application inference profile ARNs, keyed `<team>.<model>`. |
| `chart_values` | no | Values for `charts/touchline` when you deploy it yourself (`deploy_workloads = false`). Contains no secrets: the chart reads the Terraform-created Secrets by name. |
| `gateway_ca_pem` | no | Private CA that signs the gateway certificate, for `curl --cacert` over `just gateway-tunnel` only. Never add it to a system or browser trust store: it can sign a certificate for any hostname. |
| `gateway_cert_pem` | no | The gateway's public leaf certificate. `just login-tunnel` derives its SPKI pin from this and passes it to a throwaway browser profile. |

See also [examples/complete](https://github.com/rknightion/grafana-aio11y-demo/tree/main/examples/complete)
for a working set of inputs, and [Reference: Helm chart values](reference-helm.md) for the chart
this module installs.
