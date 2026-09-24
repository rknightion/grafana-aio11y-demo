# Ingest endpoints and credentials, as one object other files consume (root aliases it to
# local.grafana_ingest). Every value is derived from the stack; nothing is region-specific.

locals {
  grafana_stack = data.grafana_cloud_stack.this

  # AWS metric streams: documented derivation in "Configure metric streams with Terraform"
  # (grafana.com/docs/grafana-cloud/monitor-infrastructure/monitor-cloud-provider/aws/cloudwatch-metrics/config-cw-metric-streams/):
  # replace "prometheus" with "aws-metric-streams", drop the "-<cluster slug>" suffix, append
  # /aws-metrics/api/v1/push. https://prometheus-prod-03-prod-us-central-0.grafana.net becomes
  # https://aws-metric-streams-prod-03.grafana.net/aws-metrics/api/v1/push.
  grafana_metric_streams_derived = format("%s/aws-metrics/api/v1/push", replace(
    replace(trimsuffix(local.grafana_stack.prometheus_url, "/"), "prometheus", "aws-metric-streams"),
    "-${local.grafana_stack.cluster_slug}",
    ""
  ))

  # Logs with Firehose: documented derivation in "Configure Logs with Firehose"
  # (grafana.com/docs/grafana-cloud/monitor-infrastructure/monitor-cloud-provider/aws/logs/firehose-logs/config-firehose-logs/):
  # prepend "aws-" to the Loki hostname (the Loki cell id) and append /aws-logs/api/v1/push.
  # https://logs-prod3.grafana.net becomes https://aws-logs-prod3.grafana.net/aws-logs/api/v1/push.
  grafana_firehose_logs_derived = format("https://aws-%s/aws-logs/api/v1/push",
    regex("^https?://([^/]+)", local.grafana_stack.logs_url)[0]
  )

  grafana_ingest_l4 = {
    # OTLP gateway: basic auth, username = stack id, password = the ingest token.
    otlp_endpoint = "${trimsuffix(trimsuffix(local.grafana_stack.otlp_url, "/"), "/otlp")}/otlp"
    otlp_username = tostring(local.grafana_stack.id)
    # Deviation from the seam key list: the OTLP password needs its own key. Same token as
    # agento11y_token (metrics/logs/traces write + sigil write).
    otlp_token = grafana_cloud_access_policy_token.ingest.token

    # Firehose credentials (metrics + logs write only). Firehose sends "<instance id>:<token>".
    metrics_write_token = grafana_cloud_access_policy_token.aws.token
    logs_write_token    = grafana_cloud_access_policy_token.aws.token
    prometheus_user_id  = tostring(local.grafana_stack.prometheus_user_id)
    loki_user_id        = tostring(local.grafana_stack.logs_user_id)
    metric_streams_url  = coalesce(var.grafana_aws_endpoints.metric_streams, local.grafana_metric_streams_derived)
    firehose_logs_url   = coalesce(var.grafana_aws_endpoints.firehose_logs, local.grafana_firehose_logs_derived)

    # Agent Observability ingest: https://agento11y-prod-<region>.grafana.net, tenant = stack id,
    # basic auth with a sigil:write token.
    agento11y_endpoint = "https://agento11y-prod-${trimprefix(local.grafana_stack.region_slug, "prod-")}.grafana.net"
    agento11y_tenant   = tostring(local.grafana_stack.id)
    agento11y_token    = grafana_cloud_access_policy_token.ingest.token
    # Claude Code plugin token pushed to developer sessions (sigil + metrics + traces write).
    agento11y_client_token = grafana_cloud_access_policy_token.client.token

    # PDC agent on the agent host: -token, -cluster, -gcloud-hosted-grafana-id (= stack_id).
    pdc_token   = grafana_cloud_private_data_source_connect_network_token.this.token
    pdc_cluster = local.grafana_stack.cluster_slug
    stack_id    = tostring(local.grafana_stack.id)

    # Faro collector for the <prefix>-faro Secret; empty when frontend observability is off.
    faro_collector_url = try(grafana_frontend_o11y_app.site[0].collector_endpoint, "")
  }
}
