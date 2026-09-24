# Flux

Deploy the in-cluster workloads (`charts/touchline`) with Flux instead of Terraform's
`helm_release`.

Terraform still creates the AWS and Grafana half, and in the cluster the namespace, the Secrets
the chart reads (`touchline-grafana-otlp`, `touchline-agento11y`, `touchline-faro`,
`touchline-experiments`) and the EKS Pod Identity association for the `touchline-agents` service
account. Only the chart moves to Flux.

## Steps

1. Apply the module with `deploy_workloads = false`.
2. Create the values ConfigMap from the module output:

   ```bash
   tofu -chdir=examples/complete output -raw chart_values > touchline-values.local.yaml
   kubectl -n touchline create configmap touchline-values \
     --from-file=values.yaml=touchline-values.local.yaml --dry-run=client -o yaml | kubectl apply -f -
   ```

3. Set the `ref` in [gitrepository.yaml](gitrepository.yaml) to the release tag your Terraform
   module source uses.
4. Apply both: `kubectl apply -f deploy/flux/gitrepository.yaml -f deploy/flux/helmrelease.yaml`.

In a real GitOps setup, commit these two files (and a generated ConfigMap) to your own Flux
repository. The values contain no secrets, but they do contain your AWS account id.

## Notes

- Refresh the ConfigMap after any apply that changes models, teams or images; Flux upgrades the
  release when the ConfigMap changes.
- Before destroying the module, delete the HelmRelease and wait for the uninstall
  ([docs/teardown.md](../../docs/teardown.md)).
