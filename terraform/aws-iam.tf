# EKS Pod Identity for the in-app agents only. The site, load generator and experiments service
# accounts (created by the chart) have no AWS access.

data "aws_iam_policy_document" "agents_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]
    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
    # EKS Pod Identity tags the session; pin the role to this cluster, namespace and service account.
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/eks-cluster-name"
      values   = [var.cluster_name]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/kubernetes-namespace"
      values   = [var.namespace]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/kubernetes-service-account"
      values   = [local.service_accounts.agents]
    }
  }
}

resource "aws_iam_role" "agents" {
  name               = "${local.prefix}-agents"
  description        = "Assumed through EKS Pod Identity by ${var.namespace}/${local.service_accounts.agents}"
  assume_role_policy = data.aws_iam_policy_document.agents_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "agents_bedrock" {
  name   = "${local.prefix}-agents-bedrock"
  role   = aws_iam_role.agents.id
  policy = data.aws_iam_policy_document.bedrock_invoke.json
}

resource "aws_eks_pod_identity_association" "agents" {
  cluster_name    = var.cluster_name
  namespace       = var.namespace
  service_account = local.service_accounts.agents
  role_arn        = aws_iam_role.agents.arn
  tags            = var.tags
}
