# Example: the complete demo

Calls the module in [terraform/](../../terraform) against an existing EKS cluster and a Grafana
Cloud stack. Providers are configured here, in the root, and passed to the module; the module
never configures a provider or reads EKS data sources itself.

- `aws`: your account and region.
- `kubernetes` and `helm` (provider v3 syntax): the cluster endpoint and CA from
  `data.aws_eks_cluster`, with a fresh `aws eks get-token` on every call.
- `grafana.cloud`: a Cloud access policy token plus the Frontend Observability token.
- `grafana.stack`: the stack URL and an Admin service account token.

The required scopes and one-time stack setup are in
[docs/prerequisites.md](../../docs/prerequisites.md).

## Use

```bash
cp examples/complete/terraform.tfvars.example examples/complete/terraform.tfvars
$EDITOR examples/complete/terraform.tfvars      # gitignored; never commit it

tofu -chdir=examples/complete init
tofu -chdir=examples/complete apply
tofu -chdir=examples/complete output dashboards
```

Prefer `TF_VAR_grafana_cloud_access_policy_token`, `TF_VAR_grafana_frontend_o11y_api_access_token`
and `TF_VAR_grafana_stack_service_account_token` in your shell over writing tokens to the file.

`agent_host_subnet_id = null` skips the agent host, and with it the gateway and the developers.

This root exposes a handful of the module's inputs. Every other input in
[terraform/variables.tf](../../terraform/variables.tf) (developers, teams, spend caps, models,
traffic rates, images, site ingress and so on) can be added to the `module "demo"` block.

## Using the module from git

Replace the local `source` with a pinned release:

```hcl
source = "github.com/rknightion/grafana-aio11y-demo//terraform?ref=vX.Y.Z"
```

## State

No backend is configured, so state is local. It contains every credential the demo generates
([docs/security.md](../../docs/security.md#credentials-in-terraform-state)); add an encrypted
remote backend for anything beyond a short demo.
