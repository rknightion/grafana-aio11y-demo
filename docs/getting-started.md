---
title: Getting started
description: Prerequisites and a ten-minute quickstart for grafana-aio11y-demo.
---

# Getting started

## Prerequisites

Short version below. [Prerequisites](prerequisites.md) has every scope and switch.

- A Grafana Cloud stack with Agent Observability enabled and its LLM-judge provider pointed at
  Bedrock, the Knowledge Graph initialized, and the simplified-routing and Grafana-managed
  recording rule features available.
- Three Grafana credentials: a Cloud access policy token (access policies, stacks), a Frontend
  Observability token, and an Admin service account token on the stack.
- An AWS account with Bedrock model access for the Anthropic models (including Anthropic's
  one-time use-case form), cross-region inference profiles allowed by your SCPs, and permission to
  create IAM roles, Cognito, EC2, Secrets Manager, Firehose and CloudWatch resources.
- An EKS cluster with the Pod Identity agent (built in on Auto Mode), or use
  [examples/eks-auto-mode](https://github.com/rknightion/grafana-aio11y-demo/tree/main/examples/eks-auto-mode)
  to create one, plus a subnet with NAT for the agent host.
- Tools: OpenTofu 1.8+ or Terraform 1.8+, the AWS CLI with the Session Manager plugin, `helm`,
  `kubectl` and [`just`](https://github.com/casey/just).

## Quickstart

About ten minutes of typing. EKS cluster creation alone usually takes 10 to 15 minutes of waiting.
The commands use `tofu`; `terraform` works the same way.

```bash
git clone https://github.com/rknightion/grafana-aio11y-demo
cd grafana-aio11y-demo

# 1. A VPC and an EKS Auto Mode cluster (skip if you bring your own cluster)
tofu -chdir=examples/eks-auto-mode init
tofu -chdir=examples/eks-auto-mode apply

# 2. The demo, against that cluster
cp examples/complete/terraform.tfvars.example examples/complete/terraform.tfvars
tofu -chdir=examples/eks-auto-mode output -raw agent_host_subnet_id   # paste into terraform.tfvars
$EDITOR examples/complete/terraform.tfvars                             # stack slug and URL, region

export TF_VAR_grafana_cloud_access_policy_token=...        # or put them in terraform.tfvars
export TF_VAR_grafana_frontend_o11y_api_access_token=...
export TF_VAR_grafana_stack_service_account_token=...

tofu -chdir=examples/complete init
tofu -chdir=examples/complete apply

# 3. Open the dashboards
tofu -chdir=examples/complete output dashboards
```

With an existing cluster, skip step 1. Set `cluster_name` and a NAT-routed `agent_host_subnet_id` in
`terraform.tfvars`, make sure your AWS credentials can reach the cluster API (the example
authenticates with `aws eks get-token`), and run step 2.

After apply, the in-cluster agents start serving load generator traffic straight away. The agent
host boots, installs the pinned Claude Code release, and its login bot signs each developer in to
the gateway. Developers then start a session every 20 minutes on average, so give the Claude Code
and gateway dashboards about half an hour before presenting. If a developer does not sign in, run
`just login-developers` (see [Coding agents and the gateway](coding-agents.md)).

To look at the site: `kubectl -n touchline port-forward svc/touchline-site-api 8080:8080`, then
open http://localhost:8080.

## Where to go next

- [Architecture](architecture.md) for what got created and why
- [Demo runbook](demo-runbook.md) for a presenter flow
- [Data source tiers](data-sources.md) for what each dashboard tab actually shows
- [Cost](cost.md) before leaving it running for more than a few hours
