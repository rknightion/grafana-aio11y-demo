# Frontend Observability app for the site's browser code (Faro). Its collector URL reaches the chart
# through the <prefix>-faro Secret (local.grafana_ingest_l4.faro_collector_url).
#
# This resource talks to the Frontend Observability API through the grafana.cloud provider alias,
# which therefore also needs frontend_o11y_api_access_token set (a Cloud access policy token with the
# frontend-observability scopes); see docs/prerequisites.

resource "grafana_frontend_o11y_app" "site" {
  provider = grafana.cloud
  count    = var.frontend_observability_enabled ? 1 : 0

  stack_id = data.grafana_cloud_stack.this.id
  name     = local.service_names.site_web

  # With an Ingress the browser origin is known; without one the site is reached through
  # kubectl port-forward or the in-cluster headless load generator, so any origin is allowed.
  allowed_origins = var.site_ingress != null ? ["https://${var.site_ingress.host}", "http://${var.site_ingress.host}"] : ["*"]

  extra_log_attributes = {
    service_namespace = local.prefix
  }

  settings = {
    "combineLabData" = "0"
  }
}
