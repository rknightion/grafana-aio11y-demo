# Folder and the four dashboards (v2 schema). The dashboards are templates so every name follows
# var.name: service names, the recorded-metric prefix, rule ids, datasource uids and the Bedrock
# inference profile ids (which only exist after apply) are substituted at plan time.

resource "grafana_folder" "this" {
  provider = grafana.stack

  uid   = local.grafana.folder_uid
  title = "${local.prefix} AI observability demo"
}

locals {
  grafana_dashboard_uids = { for d in local.grafana.dashboards : d => "${local.prefix}-${d}" }

  grafana_dashboard_urls = {
    for d, uid in local.grafana_dashboard_uids : d => "${trimsuffix(data.grafana_cloud_stack.this.url, "/")}/d/${uid}"
  }

  # Names on the AWS side that the Bedrock panels query, matching aws-bedrock.tf and
  # aws-metric-stream.tf: the invocation-log Firehose stamps these two static Loki labels.
  grafana_bedrock_log_group     = "/aws/bedrock/${local.prefix}-invocations"
  grafana_bedrock_metric_stream = "${local.prefix}-bedrock"
  grafana_bedrock_log_selector  = "{service_namespace=\"${local.prefix}\", service_name=\"${local.prefix}-bedrock-invocations\"}"

  # Rule and guard ids shared by dashboards, alert rules and grafana-agento11y.tf.
  grafana_ids = {
    eval_agents_quality     = "${local.grafana.guard_prefix}_agents_quality_online"
    eval_claude_code        = "${local.grafana.guard_prefix}_claude_code_online"
    guard_agents_injection  = "${local.grafana.guard_prefix}_agents_injected_tool_result"
    guard_claude_code_pii   = "${local.grafana.guard_prefix}_claude_code_pii_gate"
    guard_claude_code_regex = "${local.grafana.guard_prefix}_claude_code_.*"
    any_rule_regex          = "${local.grafana.guard_prefix}_.*"
  }

  # In-app agent service names as one regex alternation (PromQL, LogQL and TraceQL all anchor it).
  grafana_agents_regex = join("|", [for k in sort(keys(local.agent_teams)) : local.service_names[k]])

  # Bedrock invocation log: modelId is the application inference profile ARN. Map its id suffix to
  # "team / model" (in-app agents and gateway) with a Go template chain for LogQL label_format.
  grafana_profile_ids = {
    for k, p in aws_bedrock_inference_profile.team_model : k => element(split("/", p.arn), 1)
  }
  grafana_profile_chain = format("{{ if false }}%s{{ else }}{{ .pid }}{{ end }}", join("", [
    for k, id in local.grafana_profile_ids :
    "{{ else if eq .pid \"${id}\" }}${local.team_models[k].team} / ${local.team_models[k].model}"
  ]))
  grafana_model_chain = format("{{ if false }}%s{{ else }}other ({{ .pid }}){{ end }}", join("", [
    for k, id in local.grafana_profile_ids :
    "{{ else if eq .pid \"${id}\" }}${local.team_models[k].model}"
  ]))

  # Raw template values. Each is JSON-string-escaped below because it lands inside a JSON string.
  grafana_dashboard_values = merge(
    { for k, v in local.service_names : "svc_${k}" => v },
    { for d, uid in local.grafana_dashboard_uids : "dash_${replace(d, "-", "_")}" => uid },
    {
      prefix        = local.prefix
      metric_prefix = local.grafana.metric_prefix
      demo_label    = local.grafana.demo_label
      folder_uid    = local.grafana.folder_uid
      ds_prom       = local.grafana.datasource_prom
      ds_logs       = local.grafana.datasource_logs
      ds_traces     = local.grafana.datasource_traces
      ds_spend      = local.grafana.spend_datasource
      agents_re     = local.grafana_agents_regex
      # Span attribute `team` on the agents' generation spans, promoted as an Application
      # Observability span-metrics dimension (a documented manual step).
      team_label           = "team"
      eval_quality_rule    = local.grafana_ids.eval_agents_quality
      guard_injection_rule = local.grafana_ids.guard_agents_injection
      cc_guard_re          = local.grafana_ids.guard_claude_code_regex
      eval_rule_re         = local.grafana_ids.any_rule_regex
      cc_tag_key           = local.grafana_agento11y_tag_key
      invocation_log_group = local.grafana_bedrock_log_group
      bedrock_log_selector = local.grafana_bedrock_log_selector
      metric_stream_name   = local.grafana_bedrock_metric_stream
      invocation_logging_note = (var.bedrock_invocation_logging_enabled
        ? "Invocation logging is **on** for this deployment."
        : "Invocation logging is **off** for this deployment (`bedrock_invocation_logging_enabled = false`), so these panels stay empty."
      )
      profile_chain = local.grafana_profile_chain
      model_chain   = local.grafana_model_chain
      # Pod Identity role sessions are named eks-<cluster>-<pod>-<uuid>; capture the agent service.
      agent_caller_re = ".*/eks-.*?-(${local.prefix}-(?:${join("|", sort(keys(local.agent_teams)))}))-.*"
      # The gateway calls Bedrock as the agent host's instance role (L3 names it <prefix>-agent-host...).
      gateway_caller_re = ".*:assumed-role/${local.prefix}-agent-host[^/]*/.*"
    },
  )
  grafana_dashboard_vars = {
    for k, v in local.grafana_dashboard_values : k => trimsuffix(trimprefix(jsonencode(v), "\""), "\"")
  }
}

resource "grafana_apps_dashboard_dashboard_v2" "this" {
  provider = grafana.stack
  for_each = local.grafana_dashboard_uids

  metadata {
    uid        = each.value
    folder_uid = grafana_folder.this.uid
  }

  spec {
    json = jsonencode(jsondecode(templatefile("${path.module}/dashboards/${each.key}.json.tftpl", local.grafana_dashboard_vars)).spec)
  }
}
