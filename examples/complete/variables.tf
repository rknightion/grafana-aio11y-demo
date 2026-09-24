# --- Where it runs ------------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region of the cluster, the agent host and the Bedrock profiles."
  type        = string
  default     = "eu-west-1"
}

variable "cluster_name" {
  description = "Existing EKS cluster (Pod Identity agent required; built in on Auto Mode)."
  type        = string
}

variable "agent_host_subnet_id" {
  description = "Private subnet with a NAT route for the agent host. null skips the host (and with it the gateway and developers)."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags on every AWS resource."
  type        = map(string)
  default = {
    Project = "touchline-demo"
  }
}

# --- Grafana Cloud (all three tokens are sensitive; set them in terraform.tfvars or TF_VAR_*) ----

variable "grafana_cloud_stack_slug" {
  description = "Slug of the Grafana Cloud stack, the <slug> in https://<slug>.grafana.net."
  type        = string
}

variable "grafana_stack_url" {
  description = "Stack URL, e.g. https://<slug>.grafana.net."
  type        = string
}

variable "grafana_cloud_access_policy_token" {
  description = "Cloud access policy token for the grafana.cloud alias (see docs/prerequisites.md for scopes)."
  type        = string
  sensitive   = true
}

variable "grafana_frontend_o11y_api_access_token" {
  description = "Cloud access policy token with the Frontend Observability scopes. Only needed when frontend_observability_enabled."
  type        = string
  sensitive   = true
  default     = null
}

variable "grafana_stack_service_account_token" {
  description = "Admin service account token on the stack, for the grafana.stack alias."
  type        = string
  sensitive   = true
}

# --- Demo knobs (a subset of the module's inputs; add more as you need them) --------------------

variable "traffic_enabled" {
  description = "Master switch for all synthetic traffic. false leaves everything deployed but idle (Bedrock spend stops)."
  type        = bool
  default     = true
}

variable "deploy_workloads" {
  description = "false when Argo CD, Flux or kubectl deploys charts/touchline instead of Terraform."
  type        = bool
  default     = true
}

variable "bedrock_models" {
  description = "Model key => system cross-region inference profile id. The prefix must match aws_region."
  type        = map(string)
  default = {
    haiku  = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
    sonnet = "eu.anthropic.claude-sonnet-4-6"
  }
}

variable "bedrock_invocation_logging_enabled" {
  description = "Account- and region-wide Bedrock invocation logging with content. Read docs/security.md first."
  type        = bool
  default     = false
}

variable "frontend_observability_enabled" {
  description = "Create the Frontend Observability app and instrument the site with Faro."
  type        = bool
  default     = true
}

variable "manage_app_observability" {
  description = "Let the module switch Application Observability on. Destroy switches it off stack-wide."
  type        = bool
  default     = false
}
