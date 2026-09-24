output "dashboards" {
  description = "Grafana dashboard URLs."
  value       = local.grafana_dashboard_urls
}

output "agent_host_instance_id" {
  description = "EC2 instance id of the agent host (use with `aws ssm start-session`)."
  value       = try(aws_instance.agent_host[0].id, null)
}

output "gateway_url" {
  description = "Gateway URL as the developer containers see it. From your laptop use `just gateway-tunnel` and https://localhost:8443."
  value       = "https://${local.gateway_hostname}"
}

output "cognito_user_pool_id" {
  description = "Cognito user pool holding the demo developers."
  value       = aws_cognito_user_pool.gateway.id
}

output "developers" {
  description = "Developer usernames by team."
  value       = { for name, d in local.developers : name => d.team }
}

output "developer_passwords" {
  description = "Generated Cognito passwords, for signing in by hand if the login bot fails."
  value       = { for name, p in random_password.developer : name => p.result }
  sensitive   = true
}

output "gateway_admin_read_key" {
  description = "Gateway admin read key for the spend API and admin UI over the tunnel."
  value       = random_password.gateway_admin_read_key.result
  sensitive   = true
}

output "agents_role_arn" {
  description = "IAM role the in-app agents assume through EKS Pod Identity."
  value       = aws_iam_role.agents.arn
}

output "bedrock_team_profiles" {
  description = "Per-team application inference profile ARNs, keyed <team>.<model>."
  value       = local.model_profile_arn
}

output "chart_values" {
  description = "Values for charts/touchline when you deploy it yourself (deploy_workloads = false). Contains no secrets: the chart reads the Terraform-created Secrets by name."
  value       = yamlencode(local.chart_values)
}

output "gateway_ca_pem" {
  description = "Private CA that signs the gateway certificate, for `curl --cacert` over `just gateway-tunnel` only. Never add it to a system or browser trust store: it can sign a certificate for any hostname."
  value       = tls_self_signed_cert.gateway_ca.cert_pem
}

output "gateway_cert_pem" {
  description = "The gateway's public leaf certificate. `just login-tunnel` derives its SPKI pin from this and passes it to a throwaway browser profile."
  value       = tls_locally_signed_cert.gateway.cert_pem
}
