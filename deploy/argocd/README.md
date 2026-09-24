# Argo CD

Deploy the in-cluster workloads (`charts/touchline`) with Argo CD instead of Terraform's
`helm_release`.

Terraform still creates the AWS and Grafana half, and in the cluster the namespace, the Secrets
the chart reads (`touchline-grafana-otlp`, `touchline-agento11y`, `touchline-faro`,
`touchline-experiments`) and the EKS Pod Identity association for the `touchline-agents` service
account. Only the chart moves to Argo CD.

## Steps

1. Apply the module with `deploy_workloads = false` (in `examples/complete/terraform.tfvars`).
2. Write the chart values from the module output:

   ```bash
   tofu -chdir=examples/complete output -raw chart_values > touchline-values.local.yaml
   ```

3. Put them into [application.yaml](application.yaml) as `spec.source.helm.valuesObject`, either by
   pasting them in under `valuesObject:` or with [yq](https://github.com/mikefarah/yq) v4:

   ```bash
   yq -i '.spec.source.helm.valuesObject = load("touchline-values.local.yaml")' deploy/argocd/application.yaml
   ```

4. Set `targetRevision` to the release tag your Terraform module source uses, so the chart and the
   module match.
5. Apply it: `kubectl apply -f deploy/argocd/application.yaml`.

The values contain no secrets, but they do contain your AWS account id (in the inference profile
ARNs). Keep the filled-in file in your own GitOps repository rather than committing it here.

## Notes

- Keep `CreateNamespace=false`: Terraform owns the namespace.
- Re-run step 2 and 3 after any apply that changes models, teams or images, since the profile ARNs
  and image settings live in the values.
- Before destroying the module, delete the Application and let it prune
  ([docs/teardown.md](../../docs/teardown.md)).
