output "dashboards" {
  description = "Grafana dashboard URLs."
  value       = module.demo.dashboards
}

output "agent_host_instance_id" {
  description = "Agent host instance id (used by `just login-developers` and `just gateway-tunnel`)."
  value       = module.demo.agent_host_instance_id
}

output "gateway_url" {
  description = "Gateway URL as the developer containers see it."
  value       = module.demo.gateway_url
}

output "cognito_user_pool_id" {
  description = "Cognito user pool holding the demo developers."
  value       = module.demo.cognito_user_pool_id
}

output "developers" {
  description = "Developer usernames by team."
  value       = module.demo.developers
}

output "developer_passwords" {
  description = "Generated Cognito passwords, for a manual sign-in."
  value       = module.demo.developer_passwords
  sensitive   = true
}

output "gateway_admin_read_key" {
  description = "Gateway admin read key (spend API over the tunnel)."
  value       = module.demo.gateway_admin_read_key
  sensitive   = true
}

output "agents_role_arn" {
  description = "IAM role the in-app agents assume through EKS Pod Identity."
  value       = module.demo.agents_role_arn
}

output "bedrock_team_profiles" {
  description = "Per-team application inference profile ARNs, keyed <team>.<model>."
  value       = module.demo.bedrock_team_profiles
}

output "chart_values" {
  description = "Values for charts/touchline when deploy_workloads = false (no secrets)."
  value       = module.demo.chart_values
}

output "gateway_ca_pem" {
  description = "Private CA for `curl --cacert` over `just gateway-tunnel` only; never add it to a system or browser trust store."
  value       = module.demo.gateway_ca_pem
}

output "gateway_cert_pem" {
  description = "Gateway leaf certificate; `just login-tunnel` pins its public key in a throwaway browser profile."
  value       = module.demo.gateway_cert_pem
}
