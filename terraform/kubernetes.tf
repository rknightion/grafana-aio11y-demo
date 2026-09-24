# The in-cluster half: namespace, the Secrets the chart reads by name, and the chart itself.
# The chart never creates Secrets, so Argo CD / Flux / kubectl users set deploy_workloads = false,
# keep these Secrets, and deploy charts/touchline with the values from the chart_values output.

resource "terraform_data" "team_checks" {
  lifecycle {
    precondition {
      condition     = alltrue([for t in values(local.agent_teams) : contains(var.teams, t)])
      error_message = "The in-app agents belong to teams ${join(", ", distinct(values(local.agent_teams)))}; keep all of them in var.teams."
    }
    precondition {
      condition     = alltrue([for t, models in var.team_model_allowlist : contains(var.teams, t) && alltrue([for m in models : contains(var.gateway_models, m)])])
      error_message = "team_model_allowlist keys must be teams and its values must be gateway_models keys."
    }
  }
}

resource "kubernetes_namespace_v1" "this" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of" = local.prefix
    }
  }
}

resource "kubernetes_secret_v1" "grafana_otlp" {
  metadata {
    name      = "${local.prefix}-grafana-otlp"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  data = {
    endpoint = local.grafana_ingest.otlp_endpoint
    username = local.grafana_ingest.otlp_username
    password = local.grafana_ingest.otlp_token
  }
}

resource "kubernetes_secret_v1" "agento11y" {
  metadata {
    name      = "${local.prefix}-agento11y"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  data = {
    endpoint  = local.grafana_ingest.agento11y_endpoint
    tenant_id = local.grafana_ingest.agento11y_tenant
    token     = local.grafana_ingest.agento11y_token
  }
}

resource "kubernetes_secret_v1" "faro" {
  metadata {
    name      = "${local.prefix}-faro"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  data = {
    collector_url = local.grafana_ingest.faro_collector_url
  }
}

# The scheduled experiments publish their test suite through the Grafana API, which needs a stack
# service account (Admin: Agent Observability eval writes are Admin-only by default).
resource "grafana_service_account" "experiments" {
  provider = grafana.stack
  name     = "${local.prefix}-experiments"
  role     = "Admin"
}

resource "grafana_service_account_token" "experiments" {
  provider           = grafana.stack
  name               = "${local.prefix}-experiments"
  service_account_id = grafana_service_account.experiments.id
}

resource "kubernetes_secret_v1" "experiments" {
  metadata {
    name      = "${local.prefix}-experiments"
    namespace = kubernetes_namespace_v1.this.metadata[0].name
  }
  data = {
    grafana_url = local.grafana_stack.url
    token       = grafana_service_account_token.experiments.key
  }
}

locals {
  model_profile_arn = { for k, p in aws_bedrock_inference_profile.team_model : k => p.arn }

  chart_values = {
    nameOverride = local.prefix
    namespace    = var.namespace
    images = {
      registry   = var.images.registry
      namePrefix = var.images.name_prefix
      tag        = var.images.tag
      pullSecret = var.images.pull_secret == null ? "" : var.images.pull_secret
    }
    serviceAccounts = local.service_accounts
    secrets = {
      grafanaOtlp = kubernetes_secret_v1.grafana_otlp.metadata[0].name
      agento11y   = kubernetes_secret_v1.agento11y.metadata[0].name
      faro        = kubernetes_secret_v1.faro.metadata[0].name
      experiments = kubernetes_secret_v1.experiments.metadata[0].name
    }
    aws = { region = data.aws_region.current.region }
    agents = { for role, team in local.agent_teams : role => merge(
      {
        team            = team
        modelKey        = var.agent_models[role]
        modelName       = var.bedrock_models[var.agent_models[role]]
        modelProfileArn = local.model_profile_arn["${team}.${var.agent_models[role]}"]
      },
      role == "orchestrator" ? {
        modelProfiles = { for key, id in var.bedrock_models : key => {
          arn  = local.model_profile_arn["${team}.${key}"]
          name = id
        } }
      } : {}
    ) }
    contentCapture = var.content_capture
    traffic = {
      enabled               = var.traffic_enabled
      siteRequestsPerMinute = var.site_requests_per_minute
    }
    site = { ingress = var.site_ingress }
  }
}

resource "helm_release" "this" {
  count = var.deploy_workloads ? 1 : 0

  name      = local.prefix
  namespace = kubernetes_namespace_v1.this.metadata[0].name
  chart     = local.chart_path
  # The chart version never changes between module releases, so hash the chart itself: any
  # template edit then shows up as a values change and triggers an upgrade.
  values = [yamlencode(merge(local.chart_values, {
    chartDigest = sha1(join("", [for f in sort(fileset(local.chart_path, "**")) : filesha1("${local.chart_path}/${f}")]))
  }))]

  wait    = true
  timeout = 600

  depends_on = [aws_eks_pod_identity_association.agents]
}
