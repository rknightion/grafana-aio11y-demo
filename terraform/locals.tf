# Shared names and derived maps. Frozen seam: every lane builds on these, none redefines them.

locals {
  prefix = var.name

  service_names = {
    orchestrator = "${var.name}-orchestrator"
    news         = "${var.name}-news"
    odds         = "${var.name}-odds"
    editorial    = "${var.name}-editorial"
    compliance   = "${var.name}-compliance"
    loadgen      = "${var.name}-loadgen"
    site_api     = "${var.name}-site-api"
    site_web     = "${var.name}-site-web"
    gateway      = "${var.name}-gateway"
    agent_host   = "${var.name}-agent-host"
  }

  # In-app agent => owning team (drives which application inference profile each agent calls).
  agent_teams = {
    orchestrator = "platform"
    news         = "newsroom"
    odds         = "trading"
    editorial    = "newsroom"
    compliance   = "platform"
  }

  service_accounts = {
    agents      = "${var.name}-agents"
    site        = "${var.name}-site"
    loadgen     = "${var.name}-loadgen"
    experiments = "${var.name}-experiments"
  }

  developers = { for d in var.developers : d.name => merge(d, {
    email = "${d.name}@${var.developer_email_domain}"
  }) }

  teams = toset(var.teams)

  # "<team>.<model key>" => { team, model, source_profile } for per-team application inference profiles.
  team_models = { for pair in setproduct(var.teams, keys(var.bedrock_models)) :
    "${pair[0]}.${pair[1]}" => {
      team           = pair[0]
      model          = pair[1]
      source_profile = var.bedrock_models[pair[1]]
    }
  }

  grafana = {
    folder_uid        = var.name
    spend_datasource  = "${var.name}-gateway-spend"
    contact_point     = "${var.name}-null"
    metric_prefix     = replace(var.name, "-", "_")
    demo_label        = "${replace(var.name, "-", "_")}_demo"
    dashboards        = ["agents", "bedrock", "claude-code", "gateway"]
    guard_prefix      = replace(var.name, "-", "_")
    datasource_prom   = "grafanacloud-prom"
    datasource_logs   = "grafanacloud-logs"
    datasource_traces = "grafanacloud-traces"
  }

  chart_path = "${path.module}/../charts/touchline"
}

# The AWS side and kubernetes.tf read Grafana ingest details through this one local.
locals {
  grafana_ingest = local.grafana_ingest_l4
}
