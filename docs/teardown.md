# Teardown

## Pause instead of destroy

To stop spending on Bedrock but keep everything for a later demo, set `traffic_enabled = false`
and apply. The developer sessions, the load generator and the experiment schedule stop; the
dashboards keep their history. `traffic_enabled` lives in the agent-host secret, not the host's
user data, so the host re-reads it within 5 minutes and stops the developer sessions in place;
it is not replaced, and the gateway's Postgres spend ledger survives untouched. Fixed
infrastructure (EKS, nodes, the agent host, NAT) keeps costing money; see the cost table in
[Cost](cost.md).

## Destroy

Destroy the demo first, then the cluster:

```bash
tofu -chdir=examples/complete destroy
tofu -chdir=examples/eks-auto-mode destroy
```

Order matters. The demo destroy removes Kubernetes objects through the cluster API; with the
cluster already gone it cannot, and anything the cluster created in AWS (for example a load
balancer for a `site_ingress`) is left behind and blocks the VPC destroy.

If you deployed the chart with Argo CD or Flux (`deploy_workloads = false`), delete the
Application or HelmRelease first and let it prune, so the controller does not recreate objects in
the namespace Terraform is deleting.

The module is written to destroy cleanly in one pass: Secrets Manager secrets have a zero-day
recovery window, S3 buckets are `force_destroy`, the Cognito pool has deletion protection off, and
every log group is owned by Terraform.

## What outlives destroy, or behaves unexpectedly

| Item | What happens |
|---|---|
| KMS key for invocation logs (only if `bedrock_invocation_logging_enabled`) | scheduled for deletion with a 7-day window; it shows as "pending deletion" until then. Its alias is removed at once. |
| Bedrock model invocation logging (only if enabled) | the configuration is removed, not restored to what it was before the demo. If the account had its own logging configuration, put it back yourself. |
| Application Observability (only if `manage_app_observability = true`) | destroy switches Application Observability off for the whole stack. To keep it on, drop it from state first: `tofu -chdir=examples/complete state rm 'module.demo.grafana_apps_productactivation_appo11yconfig_v1alpha1.this[0]'`. |
| Knowledge Graph onboarding (only if `manage_knowledge_graph = true`) | destroy calls the same API the onboarding wizard's disable control uses, which switches Knowledge Graph off for the whole stack, not just this demo. To keep it on, drop it from state first: `tofu -chdir=examples/complete state rm 'module.demo.grafana_asserts_stack.this[0]'` (its two tokens are still removed; onboard again by hand if you also drop the stack object from state without re-running the module). |
| CloudWatch | the demo's log groups and the metric stream are deleted. CloudWatch metrics already published (the `AWS/Bedrock` datapoints) age out on AWS's own schedule and cost nothing. Log groups that AWS services created outside Terraform, if any, are left. |
| Telemetry in Grafana Cloud | metrics, logs, traces, Agent Observability conversations and scores, Frontend Observability sessions and the `touchline_*` recorded series stay until the stack's retention removes them. Destroy removes the dashboards, rules, datasource, evaluators, guards and access policies, so the ingest tokens stop working. |
| Knowledge Graph objects (`knowledge_graph_enabled`) | the demo's service-graph rule file and trace configuration are deleted; entities already discovered age out. Scoped to this demo only, unlike the onboarding row above. |
| Terraform state | still holds the last values of every credential until you delete it. All of those credentials are revoked or deleted by the destroy. |

## If destroy fails

- **Kubernetes provider cannot reach the cluster**: the cluster is gone or your credentials
  expired. Refresh them (`aws sso login` or equivalent) and retry. If the cluster really is gone,
  remove the Kubernetes objects from state (`tofu state rm` on `module.demo.helm_release.this`,
  `module.demo.kubernetes_namespace_v1.this` and the `kubernetes_secret_v1` resources) and run
  destroy again.
- **Namespace stuck terminating**: a finalizer on something the chart did not create. Check
  `kubectl get all,ingress -n touchline` and remove the leftover object.
- **Grafana 401 or 403**: the service account or Cloud access policy token was deleted or expired
  before destroy. Create a new one with the same scopes ([prerequisites.md](prerequisites.md)) and
  retry.
- **VPC destroy blocked by dependencies** (examples/eks-auto-mode): an orphaned load balancer or
  its security group. Delete them in the EC2 console and retry.
