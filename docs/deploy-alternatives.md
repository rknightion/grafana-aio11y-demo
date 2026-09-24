# Deploy alternatives

Terraform is the first-class path: one apply creates the AWS resources, the Grafana objects, the
namespace and Secrets, and installs the chart with `helm_release`. If you would rather deploy
Kubernetes workloads with your own tooling, set `deploy_workloads = false` and Terraform stops at
the chart.

## What stays in Terraform either way

- Everything in AWS: Bedrock profiles, IAM and Pod Identity, Cognito, the agent host, the metric
  stream and invocation logging.
- Everything in Grafana Cloud: tokens, PDC, datasource, dashboards, rules, Agent Observability
  objects.
- In the cluster: the namespace, the four Secrets the chart reads by name
  (`<prefix>-grafana-otlp`, `<prefix>-agento11y`, `<prefix>-faro`, `<prefix>-experiments`) and the
  EKS Pod Identity association for the `<prefix>-agents` service account.

The chart never creates Secrets, so there are no credentials in any values file.

## What moves to you

The Helm chart in [charts/touchline](../charts/touchline/README.md), with the values from:

```bash
tofu -chdir=examples/complete output -raw chart_values
```

Those values carry the per-agent Bedrock inference profile ARNs, the image registry and tag, the
names of the Secrets and service accounts, and the traffic settings. Keep `nameOverride` and the
service account names exactly as output: the Pod Identity association and IAM role are bound to
them.

## Options

| Path | Files | How values arrive |
|---|---|---|
| Argo CD | [deploy/argocd](../deploy/argocd/README.md) | `helm.valuesObject` in the Application |
| Flux | [deploy/flux](../deploy/flux/README.md) | a ConfigMap referenced by `valuesFrom` |
| kubectl | [deploy/kubectl](../deploy/kubectl/README.md) | `just render values=...` renders manifests you apply |

## Order

1. Apply Terraform with `deploy_workloads = false`.
2. Deploy the chart with your tool, into the namespace Terraform created.
3. On teardown, remove the chart first, then destroy Terraform ([teardown.md](teardown.md)).

Whenever an apply changes models, teams, images or traffic settings, refresh the values in your
tool; `traffic_enabled` in particular reaches the in-cluster load generator only through the
values.
