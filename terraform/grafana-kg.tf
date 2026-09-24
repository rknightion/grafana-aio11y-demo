# Knowledge Graph: a custom service-graph relation so the in-app agents and the site show up as
# connected services. Tempo's service-graph metrics carry the service.namespace resource attribute
# as client_/server_service_namespace, which this demo sets to local.prefix (the default Kubernetes
# namespace has the same value). Ported from the original rule, which filtered on one asserts_env;
# this one is scoped by namespace only. Requires the Knowledge Graph to be initialized on the stack.

locals {
  grafana_kg_enabled = var.knowledge_graph_enabled
}

resource "grafana_asserts_prom_rule_file" "service_graph" {
  provider = grafana.stack
  count    = local.grafana_kg_enabled ? 1 : 0

  name   = "${local.prefix}-service-graph"
  active = true

  group {
    name     = "${local.prefix}-calls"
    interval = "1m"

    rule {
      record = "asserts:relation:calls"
      expr   = <<-EOT
        sum by (asserts_env, namespace, service, dst_namespace, dst_service) (
          label_replace(label_replace(
            rate(traces_service_graph_request_total{client_service_namespace="${local.prefix}", server_service_namespace="${local.prefix}", connection_type=""}[30m]),
          "dst_service", "$1", "server", "(.+)"),
          "dst_namespace", "$1", "server_service_namespace", "(.+)")
        )
      EOT
    }
  }
}
