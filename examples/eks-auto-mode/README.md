# Example: a VPC and an EKS Auto Mode cluster

A small, separate root that creates what the demo needs from a cluster, for when you do not have
one to hand:

- a VPC across two availability zones with public and private subnets and one NAT gateway
  ([terraform-aws-modules/vpc](https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws));
- an EKS cluster in Auto Mode with the built-in `general-purpose` and `system` node pools
  ([terraform-aws-modules/eks](https://registry.terraform.io/modules/terraform-aws-modules/eks/aws)).
  Auto Mode includes the EKS Pod Identity agent, which the demo needs.

```bash
tofu -chdir=examples/eks-auto-mode init
tofu -chdir=examples/eks-auto-mode apply
tofu -chdir=examples/eks-auto-mode output
```

Feed `cluster_name` and `agent_host_subnet_id` into [examples/complete](../complete). The
`kubeconfig_command` output sets up `kubectl`.

## Inputs

| Variable | Default | Notes |
|---|---|---|
| `aws_region` | `eu-west-1` | must suit your Bedrock inference profiles |
| `name` | `touchline` | VPC and cluster name |
| `kubernetes_version` | `null` (EKS default) | a version past standard support bills extended-support rates |
| `vpc_cidr` | `10.42.0.0/16` | |
| `single_nat_gateway` | `true` | one NAT for the VPC, the cheapest option |
| `endpoint_public_access_cidrs` | `["0.0.0.0/0"]` | **narrow this** to your own address |
| `tags` | `{ Project = "touchline-demo" }` | |

The cluster API endpoint is public so Terraform on a laptop can reach it, and whoever runs the
apply gets cluster-admin through an EKS access entry. See [docs/security.md](../../docs/security.md).

## Teardown

Destroy [examples/complete](../complete) first, then this root. See
[docs/teardown.md](../../docs/teardown.md).
