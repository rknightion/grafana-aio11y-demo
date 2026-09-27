# Plain kubectl

Render the chart to plain manifests and apply them yourself.

Terraform still creates the AWS and Grafana half, and in the cluster the namespace, the Secrets
the chart reads (`touchline-grafana-otlp`, `touchline-agento11y`, `touchline-faro`,
`touchline-experiments`) and the EKS Pod Identity association for the `touchline-agents` service
account. Only the workloads are yours to apply.

## Steps

1. Apply the module with `deploy_workloads = false`.
2. Render:

   ```bash
   tofu -chdir=examples/complete output -raw chart_values > deploy/kubectl/touchline-values.local.yaml
   just render values=deploy/kubectl/touchline-values.local.yaml
   ```

   This writes `deploy/kubectl/rendered/touchline.yaml` (needs `helm` locally).
3. Apply: `kubectl apply -n touchline -f deploy/kubectl/rendered/touchline.yaml`.

`rendered/` and `*.local.yaml` are gitignored here: they contain your AWS account id in the
inference profile ARNs.

## Notes

- Re-render and re-apply after any apply that changes models, teams or images.
- To remove the workloads before destroying the module:
  `kubectl delete -n touchline -f deploy/kubectl/rendered/touchline.yaml`.
- The chart creates namespaced Roles and RoleBindings only: Alloy's pod-metadata watch and the
  experiments job's Lease access are both scoped to the release namespace. The identity applying
  the manifests needs namespace-scoped access to create Roles, RoleBindings and the rest of the
  chart's objects, and no cluster-scoped RBAC.
