# Provider configuration lives here, in the consumer, never in the module. The module only reads
# aws, kubernetes, helm, grafana.cloud and grafana.stack as passed in below.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.tags
  }
}

# The cluster already exists (examples/eks-auto-mode or your own). Reading it here, in the root, is
# fine; the module itself never reads EKS data sources.
data "aws_eks_cluster" "this" {
  name = var.cluster_name
}

locals {
  cluster_host = data.aws_eks_cluster.this.endpoint
  cluster_ca   = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)

  # Short-lived token from the AWS CLI on every provider call, so a long apply never holds an
  # expired token.
  eks_exec = {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.aws_region]
  }
}

provider "kubernetes" {
  host                   = local.cluster_host
  cluster_ca_certificate = local.cluster_ca

  exec {
    api_version = local.eks_exec.api_version
    command     = local.eks_exec.command
    args        = local.eks_exec.args
  }
}

# Helm provider v3: kubernetes is an attribute (kubernetes = { ... }), not a block.
provider "helm" {
  kubernetes = {
    host                   = local.cluster_host
    cluster_ca_certificate = local.cluster_ca
    exec                   = local.eks_exec
  }
}

# Grafana Cloud control plane: access policies, tokens, PDC, stack lookup, Frontend Observability.
provider "grafana" {
  alias = "cloud"

  cloud_access_policy_token      = var.grafana_cloud_access_policy_token
  frontend_o11y_api_access_token = var.grafana_frontend_o11y_api_access_token
}

# The stack itself: dashboards, rules, datasources, Agent Observability objects. Admin service
# account token.
provider "grafana" {
  alias = "stack"

  url  = var.grafana_stack_url
  auth = var.grafana_stack_service_account_token
}
