output "cluster_name" {
  description = "EKS cluster name (examples/complete cluster_name)."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API endpoint."
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64 cluster CA certificate."
  value       = module.eks.cluster_certificate_authority_data
}

output "vpc_id" {
  description = "VPC id."
  value       = module.vpc.vpc_id
}

output "agent_host_subnet_id" {
  description = "A private subnet with a NAT route, for the agent host (examples/complete agent_host_subnet_id)."
  value       = module.vpc.private_subnets[0]
}

output "aws_region" {
  description = "Region the cluster runs in."
  value       = var.aws_region
}

output "kubeconfig_command" {
  description = "Command that writes a kubeconfig entry for this cluster."
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
