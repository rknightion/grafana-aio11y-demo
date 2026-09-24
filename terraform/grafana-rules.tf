# Recording and alert rule groups. Alerts use simplified routing (notification_settings) straight to
# a contact point, so the module never touches the stack's notification policy tree.

locals {
  # Share of the organization daily cap one developer may spend before the spend alert fires.
  # 5% of the default 20 USD cap is 1 USD: steady demo traffic crosses it within a few hours.
  grafana_spend_alert_fraction = 0.05
  grafana_spend_cap_usd        = lookup(coalesce(var.spend_caps.organization, {}), "daily", 20)

  grafana_rule_vars = {
    prefix             = local.prefix
    metric_prefix      = local.grafana.metric_prefix
    agents_re          = local.grafana_agents_regex
    rule_re            = local.grafana_ids.any_rule_regex
    pii_guard          = local.grafana_ids.guard_claude_code_pii
    gateway_audit      = "{service_namespace=\"${local.prefix}\", service_name=\"${local.service_names.gateway}\"} |= \"\\\"evt\\\"\" | json"
    spend_cap_usd      = local.grafana_spend_cap_usd
    spend_threshold    = local.grafana_spend_cap_usd * local.grafana_spend_alert_fraction
    spend_fraction_pct = local.grafana_spend_alert_fraction * 100
  }

  grafana_recording_rules = yamldecode(templatefile("${path.module}/rules/recording.yaml.tftpl", local.grafana_rule_vars))
  grafana_alert_rules     = yamldecode(templatefile("${path.module}/rules/alerts.yaml.tftpl", local.grafana_rule_vars))

  grafana_rule_datasources = {
    prom  = local.grafana.datasource_prom
    logs  = local.grafana.datasource_logs
    spend = grafana_data_source.spend.uid
  }

  grafana_contact_point_name = var.alert_contact_point != null ? var.alert_contact_point.name : grafana_contact_point.null[0].name

  grafana_rule_labels = {
    (local.grafana.demo_label) = "true"
    team                       = "platform"
  }
}

# Delivers nowhere: a webhook to the discard port on loopback. The alerts still fire and show in the
# alert list and on the gateway dashboard's Alerts tab without paging anyone.
resource "grafana_contact_point" "null" {
  provider = grafana.stack
  count    = var.alert_contact_point == null ? 1 : 0

  name = local.grafana.contact_point

  webhook {
    url                     = "http://127.0.0.1:9/${local.grafana.contact_point}"
    http_method             = "POST"
    disable_resolve_message = true
  }
}

resource "grafana_rule_group" "recording" {
  provider = grafana.stack

  name             = "${local.prefix}-recording"
  folder_uid       = grafana_folder.this.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.grafana_recording_rules
    content {
      # Recording rules take record{} and none of condition / no_data_state / exec_err_state.
      uid    = "${local.prefix}-${rule.value.uid}"
      name   = rule.value.metric
      labels = local.grafana_rule_labels

      data {
        ref_id         = "A"
        datasource_uid = local.grafana_rule_datasources[rule.value.datasource]
        relative_time_range {
          from = 600
          to   = 0
        }
        model = rule.value.datasource == "spend" ? jsonencode({
          refId      = "A"
          rawSql     = rule.value.expr
          format     = "table"
          rawQuery   = true
          editorMode = "code"
          }) : jsonencode(merge({
            refId         = "A"
            expr          = rule.value.expr
            instant       = true
            range         = false
            intervalMs    = 60000
            maxDataPoints = 43200
        }, rule.value.datasource == "logs" ? { queryType = "instant" } : {}))
      }

      record {
        metric                = rule.value.metric
        from                  = "A"
        target_datasource_uid = local.grafana.datasource_prom
      }
    }
  }
}

resource "grafana_rule_group" "alerts" {
  provider = grafana.stack

  name             = "${local.prefix}-alerts"
  folder_uid       = grafana_folder.this.uid
  interval_seconds = 60

  dynamic "rule" {
    for_each = local.grafana_alert_rules
    content {
      uid            = "${local.prefix}-${rule.value.uid}"
      name           = rule.value.title
      condition      = "C"
      for            = lookup(rule.value, "for", "0s")
      no_data_state  = "OK"
      exec_err_state = "Error"
      labels         = merge(local.grafana_rule_labels, { severity = rule.value.severity })
      annotations = {
        summary       = rule.value.summary
        description   = rule.value.description
        dashboard_url = local.grafana_dashboard_urls[rule.value.dashboard]
      }

      data {
        ref_id         = "A"
        datasource_uid = local.grafana_rule_datasources[rule.value.datasource]
        relative_time_range {
          from = lookup(rule.value, "range", 600)
          to   = 0
        }
        model = rule.value.datasource == "spend" ? jsonencode({
          refId      = "A"
          rawSql     = rule.value.expr
          format     = "table"
          rawQuery   = true
          editorMode = "code"
          }) : jsonencode(merge({
            refId         = "A"
            expr          = rule.value.expr
            instant       = true
            range         = false
            intervalMs    = 60000
            maxDataPoints = 43200
        }, rule.value.datasource == "logs" ? { queryType = "instant" } : {}))
      }

      data {
        ref_id         = "C"
        datasource_uid = "__expr__"
        relative_time_range {
          from = 0
          to   = 0
        }
        model = jsonencode({
          refId      = "C"
          type       = "threshold"
          expression = "A"
          conditions = [{ evaluator = { type = lookup(rule.value, "op", "gt"), params = [rule.value.threshold] } }]
        })
      }

      notification_settings {
        contact_point = local.grafana_contact_point_name
      }
    }
  }
}
