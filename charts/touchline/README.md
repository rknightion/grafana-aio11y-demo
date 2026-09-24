# touchline

Helm chart for the in-cluster half of the Touchline Times demo: the 5 in-app AI agents
(orchestrator, news, odds, editorial, compliance), the site backend, a Redis cache, a
site-traffic load generator, a scheduled experiments job, an optional synthetic-browser CronJob,
and an in-namespace Grafana Alloy collector that receives their OTLP and forwards it to Grafana
Cloud.

Not included, by design: the Claude apps gateway, its Postgres, and Private Data Source Connect.
Those run on the EC2 agent host built by `terraform/` and `agent-host/` (see the repo README and
`docs/coding-agents.md`), because the gateway and the developer containers need a machine outside
the cluster's Kubernetes RBAC boundary.

This chart never creates a Kubernetes `Secret`. It reads existing ones that Terraform already
created, by name, via `secrets.grafanaOtlp` / `secrets.agento11y` / `secrets.faro` (and optionally
`secrets.experiments`).

## Installing

Terraform installs this chart for you (`deploy_workloads = true`, the default). To install or
render it yourself:

```console
helm dependency build charts/touchline   # no-op today; see "Alloy" below
helm lint charts/touchline -f charts/touchline/ci/test-values.yaml
helm template touchline charts/touchline -f charts/touchline/ci/test-values.yaml
helm install touchline charts/touchline -n touchline --create-namespace -f my-values.yaml
```

`charts/touchline/ci/test-values.yaml` has realistic fake values (fabricated ARNs, a fake AWS
account id) safe to use for `lint`/`template`. It is not meant for a real install: the real
`modelProfileArn` values and secret contents come from the Terraform module (`terraform/`), which
renders them into a values file for `deploy_workloads = false` consumers, or supplies them
directly to `helm_release` when it installs the chart itself.

## Alloy

The chart owns a plain `Deployment` + `ConfigMap` running `grafana/alloy` directly (`alloy.yaml`),
not the upstream `grafana/alloy` Helm chart as a dependency. The plain Deployment is simpler,
needs no network access to run `helm lint`/`helm template` in CI, and lets the chart's own
templates inject the Grafana Cloud OTLP secret name and Kubernetes RBAC directly instead of
fighting Helm's static (non-templated) subchart values. `helm dependency build` is safe to run
(the `just setup` recipe always runs it) but is a no-op here since `Chart.yaml` declares no
dependencies.

The collector receives OTLP on `4317` (gRPC) / `4318` (HTTP) from every app in the namespace,
adds Kubernetes resource attributes (`k8s.namespace.name`, `k8s.pod.name`, `k8s.node.name`,
`k8s.deployment.name`) with the `k8sattributes` processor keyed off the sending pod's connection
IP, batches, and forwards metrics/logs/traces to the `secrets.grafanaOtlp` endpoint over basic
auth. The `k8sattributes` `filter.namespace` block restricts it to watching `.Values.namespace`
only, so it runs on a namespaced `Role` (`get`/`list`/`watch` on `pods` and `replicasets`, no
`ClusterRole` and no read of `namespaces`) - see the comment in `alloy.yaml`. The receiver itself
has no authentication, so a `NetworkPolicy` restricts ingress on `4317`/`4318` to pods in the
same namespace; it runs as the upstream image's non-root `alloy` user (uid `473`).

The `NetworkPolicy` only takes effect on a cluster that enforces network policy; elsewhere it is
accepted and silently ignored, and any pod in the cluster can send telemetry to the collector.
On EKS, enforcement is **off by default in both modes**. With the VPC CNI add-on, enable its
network policy agent (`enableNetworkPolicy: "true"` in the add-on configuration). On EKS Auto
Mode, network policy is built in but the controller still has to be switched on, by applying a
`ConfigMap` named `amazon-vpc-cni` in `kube-system` with
`enable-network-policy-controller: "true"`
([AWS docs](https://docs.aws.amazon.com/eks/latest/userguide/auto-net-pol.html)). The
`examples/eks-auto-mode` cluster does not apply that ConfigMap for you.

Set `alloy.enabled: false` to skip it if you already run a cluster-wide collector; in that case
point every app's OTLP endpoint at your own collector yourself (not currently exposed as a chart
value - ask for it if you need it).

### Pod log tailing

The apps write structured JSON log lines to stdout (`{"event":"generation", ...}`) that the
dashboards query directly in Loki (`| json | event="generation"`); that data never goes over
OTLP. The same Alloy also tails every pod's stdout in `.Values.namespace` through the Kubernetes
API (`discovery.kubernetes` + `loki.source.kubernetes`, no privileged container, no DaemonSet, no
node filesystem access) and feeds it into the same `otelcol.processor.batch` and
`otelcol.exporter.otlphttp` the OTLP path uses, so it reaches Grafana Cloud with the same
credentials. `discovery.kubernetes`'s `namespaces.names` keeps this namespace-scoped like the
`k8sattributes` processor above, and a `discovery.relabel` `keep` rule on the
`app.kubernetes.io/name` pod label (which every Deployment/CronJob here sets) is a second layer
of defence against tailing anything a consumer might install into the same namespace.

`otelcol.receiver.loki` converts every Loki label on a tailed entry into an OTel resource
attribute of the same name, verbatim (Alloy has no rename option in that conversion). An
`otelcol.processor.transform` (OTTL) step immediately renames the underscored labels to the
dotted OTel semantic-convention keys Grafana Cloud's OTLP endpoint promotes to Loki index labels
on ingest: `service_name` -> `service.name`, `service_namespace` -> `service.namespace` (matching
`OTEL_SERVICE_NAME`/the `service.namespace` resource attribute every app already sets),
`namespace` -> `k8s.namespace.name`, `pod` -> `k8s.pod.name`, `container` -> `k8s.container.name`.
The RBAC for this is the same `Role` as the `k8sattributes` processor above, extended with a
`pods/log` `get` rule (the kubelet log-tailing endpoint, a separate API subresource from `pods`
itself) - still namespaced, no `ClusterRole`.

A container that exposes more than one port is discovered once per port by `discovery.kubernetes`
and so is tailed more than once; only this chart's own Alloy container (ports `4317`/`4318`) hits
this, and the only effect is a few duplicate lines in Alloy's own operational logs, which nothing
here dashboards against.

## Shared image, different command

The 5 agent Deployments, the load generator and the experiments `CronJob` all run
`images.registry/images.namePrefix` + `agents:images.tag`. The load generator overrides
`command: ["npm", "run", "loadgen"]` and the experiments job overrides
`command: ["node", "experiments/run-experiment.mjs"]` with `args`, running the same agents image
in three roles rather than building three separate images.
`images.registry/images.namePrefix` + `site:images.tag` is the site backend;
`images.registry/images.namePrefix` + `site-browser:images.tag` (the `Dockerfile.browser` image,
run by the optional `siteBrowser` CronJob) is a third, separate image built from the same
`apps/site` package.

## Experiments RBAC

The experiments `CronJob` takes a `coordination.k8s.io` Lease (`<nameOverride>-experiments`,
see `apps/agents/experiments/lease.mjs`) so overlapping scheduled Jobs never double-create runs.
It runs as its own ServiceAccount, `serviceAccounts.experiments` (no AWS access), bound to a
namespaced `Role`/`RoleBinding` granting `create` on Leases (unscoped: the object does not exist
yet, so a resourceNames filter is not possible on `create`) plus `get`/`update`/`patch` scoped by
`resourceNames` to that one Lease.

## Traffic switch

`traffic.enabled: false` scales the load generator `Deployment` to 0 replicas and suspends the
experiments and site-browser `CronJob`s, rather than removing any of them, so flipping it back to
`true` needs no other change. It does not touch the agents, site or Alloy, and it has no effect
on the agent-host's own developer traffic (a separate switch, `agent-host/`).

## Values

| Key | Type | Default | Description |
|---|---|---|---|
| `nameOverride` | string | `touchline` | Prefix for every object this chart creates. Must equal Terraform's `var.name`. Frozen. |
| `namespace` | string | `touchline` | Namespace used in resource attributes and object metadata. Set to match the namespace you install into. |
| `deploymentEnvironment` | string | `demo` | Reported as `deployment.environment` on every signal. |
| `images.registry` | string | `ghcr.io/rknightion` | Registry for the `agents` and `site` images. Frozen. |
| `images.namePrefix` | string | `grafana-aio11y-demo-` | Prefixed onto every image name, e.g. `registry/namePrefixagents`. `""` for a private mirror whose repositories are already `registry/<app>`. Frozen. |
| `images.tag` | string | `0.1.0` | Tag for the `agents` and `site` images; defaults to this chart's release. Frozen. |
| `images.digests` | map | `{}` | Optional digest pins, app name to `sha256:...`; a pinned image is referenced as `<ref>:<tag>@<digest>`. Terraform sets it from `var.images.digests`. |
| `images.pullSecret` | string | `""` | Name of an existing `imagePullSecret`. Empty means none. |
| `serviceAccounts.agents` | string | `touchline-agents` | ServiceAccount for the 5 agents only. Bound to the Bedrock IAM role by EKS Pod Identity (by name; no annotation). Frozen. |
| `serviceAccounts.loadgen` | string | `touchline-loadgen` | ServiceAccount for the load generator. No AWS access, no Kubernetes API access. Frozen. |
| `serviceAccounts.experiments` | string | `touchline-experiments` | ServiceAccount for the experiments CronJob. No AWS access; bound to the Lease Role instead (see "Experiments RBAC"). Frozen. |
| `serviceAccounts.site` | string | `touchline-site` | ServiceAccount for the site. No AWS access. Frozen. |
| `secrets.grafanaOtlp` | string | `touchline-grafana-otlp` | Existing Secret (keys `endpoint`, `username`, `password`) Alloy uses to forward to Grafana Cloud. Frozen. |
| `secrets.agento11y` | string | `touchline-agento11y` | Existing Secret (keys `endpoint`, `tenant_id`, `token`) for the AI Observability SDK. Frozen. |
| `secrets.faro` | string | `touchline-faro` | Existing Secret (key `collector_url`, may be absent/empty) for frontend observability. Frozen. |
| `secrets.experiments` | string | `""` | Optional existing Secret (keys `grafana_url`, `token`) so the experiments job can publish/read the stored test suite through the Grafana control plane (`AGENTO11Y_GRAFANA_URL`/`AGENTO11Y_SERVICE_ACCOUNT_TOKEN`). Empty disables both env vars. |
| `aws.region` | string | `eu-west-1` | Region passed to the agents as `AWS_REGION`. Frozen. |
| `agentVersion` | string | `v1` | `AGENT_VERSION` on every agent, the load generator and the experiments job. Must be identical on the orchestrator and the experiments job: the runner computes each prompt variant's version independently in both processes and compares them. |
| `agents.<role>.modelProfileArn` | string | `""` | Bedrock application inference profile ARN for that agent (`MODEL_PROFILE_ARN`). Frozen key shape (`agents` map, `modelProfileArn`/`team` fields). |
| `agents.<role>.modelKey` | string | see `values.yaml` | `MODEL_KEY`: the `bedrock_models` key for this agent's default profile (e.g. `haiku`). |
| `agents.<role>.modelName` | string | `""` | `MODEL_NAME`: a Bedrock model or inference profile id (e.g. `eu.anthropic.claude-haiku-4-5-20251001-v1:0`), normalised by the app to the canonical Claude model name for the recorded `gen_ai` model. |
| `agents.orchestrator.modelProfiles` | object | `{}` | Extra `{key: {arn, name}}` profiles rendered as `MODEL_PROFILES` (compact JSON), enabling the orchestrator's per-request `x-agent-model` routing used by the model-comparison experiments. Only meaningful on `orchestrator`. |
| `agents.<role>.team` | string | see `values.yaml` | Owning team, carried through as `AGENT_TEAM` and a label. |
| `agentResources` | object | 50m/256Mi request, 512Mi limit | Resource requests/limits shared by all 5 agent Deployments. |
| `contentCapture` | bool | `true` | Sets `AGENTO11Y_CONTENT_CAPTURE_MODE` (agents/loadgen/experiments) and `CONTENT_CAPTURE` (every app, including site-browser, which has no `AGENTO11Y_*` vars since it does not use the AI Observability SDK). Frozen. See `docs/security.md`. |
| `traffic.enabled` | bool | `true` | Master switch for the load generator, the experiments schedule and the site-browser schedule. Frozen. |
| `traffic.siteRequestsPerMinute` | number | `2` | Load generator rate, passed through a ConfigMap (`requestsPerMinute` in the rate file). Frozen. |
| `traffic.experimentsSchedule` | string | `17 */2 * * *` | Cron schedule for the experiments job. Frozen. |
| `loadgen.dailyBudgetUsd` | number | `5` | Estimated Bedrock spend cap per UTC day, passed through the rate file (`dailyBudgetUsd`); the load generator itself caps this at 30 USD/day regardless. |
| `loadgen.persistence.enabled` | bool | `false` | Give the load generator a PVC for its spend ledger; `false` uses an `emptyDir` (state resets on restart), needed on clusters with no default StorageClass. |
| `loadgen.persistence.size` | string | `1Gi` | PVC size. |
| `loadgen.persistence.storageClassName` | string | `""` | Empty uses the cluster's default StorageClass. |
| `loadgen.resources` | object | 25m/128Mi request, 256Mi limit | Load generator resources. |
| `siteBrowser.enabled` | bool | `true` | Run the synthetic headless-browser reader CronJob (`site-browser` image), one real Chromium page load per run so Frontend Observability gets page loads, web vitals and browser-to-backend traces with no human visitor. |
| `siteBrowser.schedule` | string | `*/10 * * * *` | Cron schedule for the site-browser job. Suspended (not removed) when `traffic.enabled` is `false`. |
| `siteBrowser.resources` | object | 100m/256Mi request, 512Mi limit | Site-browser job resources. |
| `experiments.variantIds` | string | `brief,balanced,contextual` | `--variant-ids` passed to the scheduled experiment run. |
| `experiments.resources` | object | 50m/128Mi request, 512Mi limit | Experiments job resources. |
| `site.ingress` | object/null | `null` | `null` keeps the site ClusterIP-only. Set `{ className, host, annotations }` to expose it. Frozen key (`site.ingress`). |
| `site.resources` | object | 50m/128Mi request, 512Mi limit | Site resources. |
| `redis.image.repository` / `.tag` | string | `redis` / `7.4.6` | Redis image. No persistence: it only caches synthetic demo traffic state. |
| `redis.resources` | object | 25m/64Mi request, 128Mi limit | Redis resources. |
| `alloy.enabled` | bool | `true` | Run the in-namespace collector. Frozen. |
| `alloy.resources` | object | 100m/256Mi request, 512Mi limit | Alloy resources. |

See `values.schema.json` for the machine-checked shape of the frozen keys, and `NOTES.txt` for
post-install port-forward instructions.
