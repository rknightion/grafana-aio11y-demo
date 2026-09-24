# Prerequisites

Everything here is a one-time setup outside Terraform. Work through it before the first apply;
most apply failures trace back to one of these.

## Grafana Cloud

### A stack

Any Grafana Cloud stack you can administer. Note its slug (the `<slug>` in
`https://<slug>.grafana.net`) and URL; they become `grafana_cloud_stack_slug` and
`grafana_stack_url` in [examples/complete](https://github.com/rknightion/grafana-aio11y-demo/tree/main/examples/complete).

A dedicated stack is simplest. On a shared stack the module scopes its objects to the demo (see
[security.md](security.md#guards-and-evaluation-scope)), but it still creates stack-wide objects
such as the Knowledge Graph rule file and, if you let it, the Application Observability switch.

**Deploying this module twice with the same `var.name` at the same Grafana Cloud stack collides.**
Every object name, access policy, folder uid and Agent Observability id derives from `name`
(`touchline` by default), so a second deployment with the same name fights the first over the
same Grafana objects and access policies instead of creating a second, independent set. Give each
deployment on a shared stack its own `name`.

### Cloud access policy token (the `grafana.cloud` provider alias)

Create an access policy in the Grafana Cloud portal (Administration > Users and access > Cloud
access policies) with realm **your organization**, and a token for it. Scopes:

| Scope | Why |
|---|---|
| `stacks:read` | look up the stack (`data.grafana_cloud_stack`): ids, URLs, region |
| `accesspolicies:read`, `accesspolicies:write`, `accesspolicies:delete` | create the ingest and Firehose access policies and tokens, and the Private Data source Connect (PDC) network and its token (PDC resources use the access policy scopes) |

Pass it as `grafana_cloud_access_policy_token`.

### Frontend Observability token

The Frontend Observability app is managed through its own API, so the `grafana.cloud` alias also
needs `frontend_o11y_api_access_token`: a Cloud access policy token with
`frontend-observability:read`, `frontend-observability:write` and
`frontend-observability:delete` on the stack. It can be a second token or the same policy with
these scopes added. Pass it as `grafana_frontend_o11y_api_access_token`. Not needed when
`frontend_observability_enabled = false`.

### Admin service account token (the `grafana.stack` alias)

In the stack, Administration > Users and access > Service accounts: create a service account with
the Admin role and a token. Admin is required because Agent Observability evaluator, guard and
rule writes are Admin-only by default, and the module also creates a service account (for the
experiments), a datasource, dashboards and alert rules. Pass it as
`grafana_stack_service_account_token`.

The `grafana.stack` provider also needs `stack_id` (the numeric stack id): the Knowledge Graph
resources refuse to plan without it. `examples/complete` reads it from `data.grafana_cloud_stack`
through the `grafana.cloud` alias.

### Agent Observability

- Enable the Agent Observability app on the stack (Observability > Agent).
- Point its LLM-judge provider at Amazon Bedrock. The module's `llm_judge` evaluators ask for
  provider `bedrock` and the model in `bedrock_models[judge_model]` (Haiku by default). The judge
  runs in Grafana Cloud, not in your cluster, so configure the provider in the app's settings with
  AWS credentials that can invoke that inference profile in your region. The module does not
  create those credentials. Without this, deterministic evaluators (regex, heuristic) still work
  and the guards still fire, but LLM-judge scores never appear.

### Knowledge Graph

Two independent switches:

- Onboarding: either initialize the Knowledge Graph yourself (Observability > Knowledge Graph,
  follow the onboarding) before the first apply, or set `manage_knowledge_graph = true` and let the
  module do it. The module then creates its own Cloud access policy token and stack Admin service
  account token to run the onboarding flow, and removes both when the variable goes back to
  `false`. Onboarding is a stack-wide singleton: destroying it (or applying with
  `manage_knowledge_graph = false` after it was true) disables Knowledge Graph for the whole
  stack, not just this demo. Leave it `false` on a shared stack that already has Knowledge Graph
  on.
- This demo's objects: with `knowledge_graph_enabled = true` (the default), the module adds a
  service-graph rule file and a trace configuration scoped to this demo's namespace, once the
  Knowledge Graph is initialized by either route above.

The `team` span-metrics dimension used by the agents dashboard stays a manual App Observability
step either way; it has no Knowledge Graph or Terraform equivalent (see
[Application Observability](#application-observability) below).

### Application Observability

The agents dashboard and the service map need Application Observability switched on. Either turn
it on yourself (Observability > Application) or set `manage_app_observability = true`. Read the
warning on that variable first: it is a stack-wide singleton, and destroy switches the product off
for the whole stack.

One manual step: the agents dashboard splits cost by team using the `team` span attribute. Add
`team` as a span-metrics dimension in Application Observability settings. There is no Terraform
resource for this; without it the per-team panels group everything under one empty team.

### Alerting features

The rules rely on two alerting features: simplified routing (rules name their contact point
directly) and Grafana-managed recording rules (the recording rules write `touchline_*` series
back to the stack's Prometheus datasource). Both are normally on for Grafana Cloud stacks. If a
rule group apply fails complaining about `notification_settings` or `record`, ask Grafana support
to enable `alertingSimplifiedRouting` and `grafanaManagedRecordingRules`.

## AWS

### Bedrock model access

- In the Bedrock console for your region, request access to the Anthropic models you use (Claude
  Haiku 4.5 and Claude Sonnet 4.6 with the defaults). Anthropic models also need the one-time
  use-case details form for the account; until it is approved every call fails with an access
  error.
- `bedrock_models` names system cross-region inference profiles (`eu.`, `us.`, `apac.`,
  `global.` and so on). The prefix must match the provider region; a plan-time check rejects a
  mismatch. For `us-east-1`, for example, use `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- SCPs: a cross-region profile serves requests from several regions (an `eu.` profile called
  from `eu-west-1` is often served elsewhere in the EU). An organization SCP that denies Bedrock
  outside your home region breaks these calls in ways that look like intermittent access errors.
  Allow `bedrock:InvokeModel*` in every destination region of the profiles you pick, or use a
  sandbox account without that restriction.
- Service quotas: the defaults are light, but Claude tokens-per-minute quotas in a new account can
  be low. Throttles show up on the Bedrock dashboard and the throttling alert.

### An EKS cluster

- Bring your own, or create one with [examples/eks-auto-mode](https://github.com/rknightion/grafana-aio11y-demo/tree/main/examples/eks-auto-mode).
- It needs the EKS Pod Identity agent add-on (built in on Auto Mode). The module creates a Pod
  Identity association for the agents' service account; without the agent the pods get no AWS
  credentials.
- The identity running Terraform needs enough Kubernetes RBAC to create a namespace, Secrets,
  service accounts, namespaced Roles and RoleBindings (Alloy's Kubernetes metadata watch and the
  experiments job's Lease access are both namespace-scoped, not cluster-wide) and the chart's
  workloads. Cluster-admin through an EKS access entry is the simple answer, but nothing here
  needs cluster-scoped RBAC.
- No StorageClass, ingress controller or load balancer controller is required. The site stays
  ClusterIP unless you set `site_ingress`.

### A subnet for the agent host

A subnet in the same account and region with outbound internet (a NAT gateway or equivalent):
the host pulls container images, downloads Claude Code, reaches SSM, Secrets Manager, S3 (the
render bundle it fetches on first boot, before anything else starts), Bedrock and Grafana Cloud.
No inbound access is needed. `examples/eks-auto-mode` outputs a private subnet that fits. Leave
`agent_host_subnet_id` unset (and `agent_host_enabled = false`) to run only the in-cluster half.

### Permissions for whoever runs apply

IAM (roles, policies, instance profile), EKS (Pod Identity associations), Bedrock (inference
profiles, and the logging configuration if you enable it), Cognito, EC2 (instance, security
group), Secrets Manager, Firehose, CloudWatch (metric stream, log groups), S3 and KMS.
`AdministratorAccess` in a sandbox account is the practical choice for a demo.

## Tools

| Tool | Used for |
|---|---|
| OpenTofu 1.8+ or Terraform 1.8+ | the apply; examples use `tofu` |
| AWS CLI v2 | the Kubernetes provider's `aws eks get-token` auth, SSM sessions |
| Session Manager plugin for the AWS CLI | `just login-developers`, `just gateway-tunnel`, any shell on the agent host |
| `kubectl` | port-forwarding to the site, looking at pods |
| `helm` | only for the Argo CD, Flux and kubectl paths (`just render`); the Terraform path uses the Helm provider |
| [`just`](https://github.com/casey/just) | the task recipes in the `justfile` |
| Docker with buildx | only to build and push images to your own registry (`just images-push`) |
