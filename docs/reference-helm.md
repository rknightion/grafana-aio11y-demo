---
title: Helm chart reference
description: Every value in the charts/touchline Helm chart.
---

# Helm chart reference

The `charts/touchline` chart values, from `charts/touchline/README.md`. Terraform installs this
chart for you by default (`deploy_workloads = true`); see
[Deploy alternatives](deploy-alternatives.md) to install it yourself with Argo CD, Flux or
kubectl.

| Key | Type | Default | Description |
|---|---|---|---|
| `nameOverride` | string | `touchline` | Prefix for every object this chart creates. Must equal Terraform's `var.name`. Frozen. |
| `namespace` | string | `touchline` | Namespace used in resource attributes and object metadata. Set to match the namespace you install into. |
| `deploymentEnvironment` | string | `demo` | Reported as `deployment.environment` on every signal. |
| `images.registry` | string | `ghcr.io/rknightion` | Registry for this chart's images (`agents`, `site`, `site-browser`). Frozen. |
| `images.namePrefix` | string | `grafana-aio11y-demo-` | Prefixed onto every image name, e.g. `registry/namePrefixagents`. `""` for a private mirror whose repositories are already `registry/<app>`. Frozen. |
| `images.tag` | string | `0.1.0` | Tag for this chart's images; defaults to this chart's release. Frozen. <!-- x-release-please-version --> |
| `images.digests` | map | `{}` | Optional digest pins, app name to `sha256:...`; a pinned image is referenced as `<ref>:<tag>@<digest>`. Terraform sets it from `var.images.digests`. |
| `images.pullSecret` | string | `""` | Name of an existing `imagePullSecret`. Empty means none. |
| `serviceAccounts.agents` | string | `touchline-agents` | ServiceAccount for the 5 agents only. Bound to the Bedrock IAM role by EKS Pod Identity (by name; no annotation). Frozen. |
| `serviceAccounts.loadgen` | string | `touchline-loadgen` | ServiceAccount for the load generator. No AWS access, no Kubernetes API access. Frozen. |
| `serviceAccounts.experiments` | string | `touchline-experiments` | ServiceAccount for the experiments CronJob. No AWS access; bound to the Lease Role instead. Frozen. |
| `serviceAccounts.site` | string | `touchline-site` | ServiceAccount for the site. No AWS access. Frozen. |
| `secrets.grafanaOtlp` | string | `touchline-grafana-otlp` | Existing Secret (keys `endpoint`, `username`, `password`) Alloy uses to forward to Grafana Cloud. Frozen. |
| `secrets.agento11y` | string | `touchline-agento11y` | Existing Secret (keys `endpoint`, `tenant_id`, `token`) for the Agent Observability SDK. Frozen. |
| `secrets.faro` | string | `touchline-faro` | Existing Secret (key `collector_url`, may be absent/empty) for frontend observability. Frozen. |
| `secrets.experiments` | string | `""` | Existing Secret (keys `grafana_url`, `token`) for the experiments job's control-plane calls (`AGENTO11Y_GRAFANA_URL`/`AGENTO11Y_SERVICE_ACCOUNT_TOKEN`): publishing the stored test suite, and every read the ingest token is refused, including evaluator scores. Terraform always sets it. Empty omits both env vars, and runs then fail at their first score read. |
| `aws.region` | string | `eu-west-1` | Region passed to the agents as `AWS_REGION`. Frozen. |
| `agentVersion` | string | `v1` | `AGENT_VERSION` on every agent, the load generator and the experiments job. Must be identical on the orchestrator and the experiments job: the runner computes each prompt variant's version independently in both processes and compares them. |
| `agents.<role>.modelProfileArn` | string | `""` | Bedrock application inference profile ARN for that agent (`MODEL_PROFILE_ARN`). Frozen key shape (`agents` map, `modelProfileArn`/`team` fields). |
| `agents.<role>.modelKey` | string | see `values.yaml` | `MODEL_KEY`: the `bedrock_models` key for this agent's default profile (e.g. `haiku`). |
| `agents.<role>.modelName` | string | `""` | `MODEL_NAME`: a Bedrock model or inference profile id, normalised by the app to the canonical Claude model name for the recorded `gen_ai` model. |
| `agents.orchestrator.modelProfiles` | object | `{}` | Extra `{key: {arn, name}}` profiles rendered as `MODEL_PROFILES` (compact JSON), enabling the orchestrator's per-request `x-agent-model` routing used by the model-comparison experiments. Only meaningful on `orchestrator`. |
| `agents.<role>.team` | string | see `values.yaml` | Owning team, carried through as `AGENT_TEAM` and a label. |
| `agentResources` | object | 50m/256Mi request, 512Mi limit | Resource requests/limits shared by all 5 agent Deployments. |
| `contentCapture` | bool | `true` | Sets `AGENTO11Y_CONTENT_CAPTURE_MODE` (agents/loadgen/experiments) and `CONTENT_CAPTURE` (every app). Frozen. See [Security](security.md). |
| `traffic.enabled` | bool | `true` | Master switch for the load generator, the experiments schedule and the site-browser schedule. Frozen. |
| `traffic.siteRequestsPerMinute` | number | `2` | Load generator rate, passed through a ConfigMap. Frozen. |
| `traffic.experimentsSchedule` | string | `17 */2 * * *` | Cron schedule for the experiments job. |
| `loadgen.dailyBudgetUsd` | number | `5` | Estimated Bedrock spend cap per UTC day, passed through the rate file; the load generator itself caps this at 30 USD/day regardless. |
| `loadgen.persistence.enabled` | bool | `false` | Give the load generator a PVC for its spend ledger; `false` uses an `emptyDir` (state resets on restart), needed on clusters with no default StorageClass. |
| `loadgen.persistence.size` | string | `1Gi` | PVC size. |
| `loadgen.persistence.storageClassName` | string | `""` | Empty uses the cluster's default StorageClass. |
| `loadgen.resources` | object | 25m/128Mi request, 256Mi limit | Load generator resources. |
| `siteBrowser.enabled` | bool | `true` | Run the synthetic headless-browser reader CronJob, one real Chromium page load per run so Frontend Observability gets page loads, web vitals and browser-to-backend traces with no human visitor. |
| `siteBrowser.schedule` | string | `*/10 * * * *` | Cron schedule for the site-browser job. Suspended (not removed) when `traffic.enabled` is `false`. |
| `siteBrowser.resources` | object | 100m/256Mi request, 512Mi limit | Site-browser job resources. |
| `experiments.variantIds` | string | `brief,balanced,contextual` | `--variant-ids` passed to the scheduled experiment run. |
| `experiments.resources` | object | 50m/128Mi request, 512Mi limit | Experiments job resources. |
| `site.ingress` | object/null | `null` | `null` keeps the site ClusterIP-only. Set `{ className, host, annotations }` to expose it. Frozen key. |
| `site.resources` | object | 50m/128Mi request, 512Mi limit | Site resources. |
| `redis.image.repository` / `.tag` | string | `redis` / `7.4.6` | Redis image. No persistence: it only caches synthetic demo traffic state. |
| `redis.resources` | object | 25m/64Mi request, 128Mi limit | Redis resources. |
| `alloy.enabled` | bool | `true` | Run the in-namespace collector. |
| `alloy.resources` | object | 100m/256Mi request, 512Mi limit | Alloy resources. |

"Frozen" keys are relied on elsewhere (the Terraform module's Pod Identity association, Secret
names, RBAC) and should not be renamed without updating every consumer.

See `charts/touchline/values.schema.json` for the machine-checked shape of the frozen keys, and
`charts/touchline/README.md` for the chart's architecture (Alloy, the shared agent image, the
experiments RBAC). See also [Reference: Terraform inputs and outputs](reference-terraform.md).
