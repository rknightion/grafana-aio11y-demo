# Application Observability on (service inventory, RED metrics from traces, service map). This is a
# stack-wide singleton ("global"): destroying the module removes this object, which switches the
# product off for the whole stack. On a shared stack that already runs Application Observability,
# import it or remove it from state before destroy (documented in teardown).
#
# The span-metrics dimension settings (for example the `team` span attribute used by the agents
# dashboard) have no provider resource and stay a documented manual step.

resource "grafana_apps_productactivation_appo11yconfig_v1alpha1" "this" {
  count    = var.manage_app_observability ? 1 : 0
  provider = grafana.stack

  metadata {
    uid = "global"
  }

  options {
    overwrite = true
  }

  spec {
    enabled = true
  }
}
