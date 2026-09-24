# Module interface. Frozen before the parallel build: change a name here only with every consumer
# (lanes, docs, examples) updated in the same change.

# --- Identity ----------------------------------------------------------------------------------

variable "name" {
  description = "Prefix for every AWS, Kubernetes and Grafana object this module creates. Must be unique per AWS account and per Grafana stack: two deployments with the same name collide on account-global IAM roles, Secrets Manager paths and the stack's prefixed Grafana objects (dashboards, rules, evaluators), and one apply or destroy then changes the other's resources."
  type        = string
  default     = "touchline"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name))
    error_message = "name must be 2-21 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "tags" {
  description = "Tags applied to every AWS resource."
  type        = map(string)
  default     = {}
}

# --- Where it runs ------------------------------------------------------------------------------

variable "cluster_name" {
  description = "Name of the existing EKS cluster the Kubernetes and Helm providers point at. Used only for EKS Pod Identity associations; the cluster needs the eks-pod-identity-agent add-on (built in on Auto Mode)."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace for the in-app agents and site. Created and owned by this module."
  type        = string
  default     = "touchline"
}

variable "deploy_workloads" {
  description = "Install the Helm chart with helm_release. Set false to deploy charts/touchline yourself with Argo CD, Flux or kubectl; the module still creates the namespace, Secrets, IAM and Grafana objects and outputs the chart values."
  type        = bool
  default     = true
}

variable "agent_host_enabled" {
  description = "Create the EC2 agent host that runs the Claude apps gateway and the developer containers."
  type        = bool
  default     = true
}

variable "agent_host_subnet_id" {
  description = "Subnet for the agent host. It needs outbound internet (NAT or equivalent) for SSM, container images, the Claude Code download, Bedrock and Grafana Cloud. Required when agent_host_enabled."
  type        = string
  default     = null
}

variable "agent_host_instance_type" {
  description = "Agent host instance type. The AMI architecture follows it (Graviton types use arm64)."
  type        = string
  default     = "t4g.xlarge"
}

# --- Grafana Cloud ------------------------------------------------------------------------------

variable "grafana_cloud_stack_slug" {
  description = "Slug of the Grafana Cloud stack that receives all telemetry and holds the dashboards, rules and Agent Observability objects. The grafana.cloud provider alias must hold a Cloud access policy token that can manage access policies, PDC and the stack; grafana.stack must point at this stack with an Admin service account token."
  type        = string
}

variable "alert_contact_point" {
  description = "Where the demo alerts route. null creates a contact point that delivers nowhere (a webhook to a blackhole address), so the alerts fire visibly without paging anyone."
  type = object({
    name = string
  })
  default = null
}

# --- Bedrock ------------------------------------------------------------------------------------

variable "bedrock_models" {
  description = "Model key => system cross-region inference profile id to copy per team, e.g. { haiku = \"eu.anthropic.claude-haiku-4-5-20251001-v1:0\" }. The profile prefix (eu., us., apac., global.) must be valid for the provider region. Model access and Anthropic's one-time use-case form must already be done in the account."
  type        = map(string)
  default = {
    haiku  = "eu.anthropic.claude-haiku-4-5-20251001-v1:0"
    sonnet = "eu.anthropic.claude-sonnet-4-6"
  }
}

variable "agent_models" {
  description = "Which bedrock_models key each in-app agent uses."
  type        = map(string)
  default = {
    orchestrator = "sonnet"
    news         = "haiku"
    odds         = "haiku"
    editorial    = "sonnet"
    compliance   = "haiku"
  }
}

variable "judge_model" {
  description = "bedrock_models key used by the Agent Observability LLM-judge evaluators."
  type        = string
  default     = "haiku"
}

variable "bedrock_invocation_logging_enabled" {
  description = "Turn on Bedrock model invocation logging and ship it to Grafana Cloud Logs. WARNING: this setting is account- and region-wide, captures prompt and completion text for every Bedrock call in the region (not just this demo), replaces any existing configuration, and destroy removes it rather than restoring a previous one. Enable in a dedicated sandbox account."
  type        = bool
  default     = false
}

variable "bedrock_metric_stream_enabled" {
  description = "Stream the AWS/Bedrock CloudWatch namespace to Grafana Cloud Metrics with a CloudWatch metric stream and Firehose."
  type        = bool
  default     = true
}

variable "grafana_aws_endpoints" {
  description = "Override the Grafana Cloud AWS ingest endpoints if derivation from the stack is wrong for your region: metric_streams (…/aws-metrics/api/v1/push) and firehose_logs (…/aws-logs/api/v1/push)."
  type = object({
    metric_streams = optional(string)
    firehose_logs  = optional(string)
  })
  default = {}
}

# --- Developers, teams and the gateway ----------------------------------------------------------

variable "teams" {
  description = "Team names. Each becomes a Cognito group (gateway policies, per-group spend caps, user.groups in telemetry) and a set of per-team Bedrock application inference profiles."
  type        = list(string)
  default     = ["newsroom", "trading", "platform"]
}

variable "developers" {
  description = "Claude Code developers signed in through the gateway, one container each on the agent host. name is a stable key (letters, digits, dots)."
  type = list(object({
    name = string
    team = string
  }))
  default = [
    { name = "alex.morgan", team = "newsroom" },
    { name = "priya.shah", team = "newsroom" },
    { name = "sam.okafor", team = "trading" },
    { name = "jordan.lee", team = "trading" },
    { name = "casey.nguyen", team = "platform" },
  ]
}

variable "developer_email_domain" {
  description = "Email domain for the generated developer identities."
  type        = string
  default     = "touchline.example"
}

variable "team_model_allowlist" {
  description = "Per-team restriction of gateway_models for the developers (team => bedrock_models keys). Teams not listed get every gateway model."
  type        = map(list(string))
  default     = { trading = ["haiku"] }
}

variable "gateway_models" {
  description = "bedrock_models keys the gateway offers to developers."
  type        = list(string)
  default     = ["haiku", "sonnet"]
}

variable "spend_caps" {
  description = "Gateway spend caps in whole USD. user keys are developer names, group keys are team names. Caps are per-seat defaults, most restrictive wins."
  type = object({
    organization = optional(map(number), { daily = 20 })
    groups       = optional(map(map(number)), { trading = { daily = 5 } })
    users        = optional(map(map(number)), { "casey.nguyen" = { daily = 2 } })
  })
  default = {}
}

variable "content_capture" {
  description = "Capture prompt text, assistant responses and tool content in telemetry (Claude Code OTEL_LOG_* settings pushed by the gateway, and the in-app agents). Needed for the prompt-level panels and content evaluators. Treat captured telemetry as sensitive."
  type        = bool
  default     = true
}

# --- Traffic and cost ---------------------------------------------------------------------------

variable "traffic_enabled" {
  description = "Master switch for all synthetic traffic: developer sessions, the site load generator and the experiment schedule. false leaves everything deployed but idle."
  type        = bool
  default     = true
}

variable "developer_session_interval_minutes" {
  description = "Mean minutes between Claude Code sessions per developer (jittered)."
  type        = number
  default     = 20
}

variable "site_requests_per_minute" {
  description = "Load generator rate against the site (each request fans out to Bedrock)."
  type        = number
  default     = 2
}

# --- Versions and images ------------------------------------------------------------------------

variable "claude_code_version" {
  description = "Claude Code release installed at container start on the agent host (gateway and developers). Never baked into images. The login bot is tested against this version."
  type        = string
  default     = "2.1.281"
}

variable "agento11y_cli_version" {
  description = "agento11y CLI and Claude Code plugin version for the developer containers. latest keeps the build pinned in the dev-workstation image and a version installs that release; either way the plugin marketplace is pinned to the matching tag."
  type        = string
  default     = "latest"
}

variable "images" {
  description = "Container image registry, name prefix and tag for this repo's images. Every image reference is \"<registry>/<name_prefix><app>:<tag>\" (app in agents, site, site-browser, mcp-tools, gateway, dev-workstation). tag is a plain tag and defaults to this module's release; digests (image name => sha256:...) pins individual images immutably; verify an image with cosign before pinning it (docs/security.md). Override registry to use a private mirror (see `just images-push`); set name_prefix = \"\" for a mirror whose repositories are already `<registry>/<app>` with no shared prefix."
  type = object({
    registry    = optional(string, "ghcr.io/rknightion")
    name_prefix = optional(string, "grafana-aio11y-demo-")
    tag         = optional(string, "0.1.0") # x-release-please-version
    digests     = optional(map(string), {})
    pull_secret = optional(string)
  })
  default = {}
}

# --- Site ---------------------------------------------------------------------------------------

variable "frontend_observability_enabled" {
  description = "Create a Grafana Frontend Observability app and instrument the site's browser code with Faro."
  type        = bool
  default     = true
}

variable "site_ingress" {
  description = "Expose the site through an Ingress. null keeps it ClusterIP only (reach it with `kubectl port-forward`, see docs)."
  type = object({
    class_name  = string
    host        = string
    annotations = optional(map(string), {})
  })
  default = null
}

# --- Stack-wide Grafana products ----------------------------------------------------------------

variable "manage_app_observability" {
  description = "Let this module switch Application Observability on. It is a stack-wide singleton: destroy switches the product off for the whole stack, so leave false on a shared stack where it is already on."
  type        = bool
  default     = false
}

variable "manage_knowledge_graph" {
  description = "Let this module perform Knowledge Graph (Asserts) onboarding: it provisions the stack's own Mimir, GCom and assertion-detector tokens, detects datasets and enables the stack, using a Cloud access policy token and a stack Admin service account token that exist only while this is true. Like manage_app_observability it is a stack-wide singleton: destroy calls the API behind the onboarding wizard's disable control, which switches Knowledge Graph off for the whole stack, not only this demo's objects. Leave false and onboard by hand (Observability > Knowledge Graph) on a shared stack that already has it on, or where a later destroy must not switch it off for other users."
  type        = bool
  default     = false
}

variable "knowledge_graph_enabled" {
  description = "Create the Knowledge Graph service-graph rule and this demo's own trace configuration (entity properties for its services, scoped to var.namespace, at a low priority so it never overrides another config on a shared stack). The Knowledge Graph must already be initialized on the stack, either by manage_knowledge_graph or by hand."
  type        = bool
  default     = true
}
