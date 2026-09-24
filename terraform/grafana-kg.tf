# Knowledge Graph (Asserts): stack onboarding (optional, off by default), the service-graph
# relation used by both dashboards and the demo's own trace configuration.

locals {
  grafana_kg_enabled = var.knowledge_graph_enabled
}

# --- Onboarding (var.manage_knowledge_graph) ----------------------------------------------------
#
# Runs the same flow as the Knowledge Graph onboarding wizard: provisions the stack's own
# Mimir/GCom/assertion-detector tokens, auto-detects datasets from whatever metrics already exist
# (Application Observability's otel dataset needs manage_app_observability or an existing AppO11y
# setup; the otel/kubernetes datasets otherwise stay undetected, which is harmless), and enables
# the stack. It is a stack-wide singleton, the same shape as manage_app_observability:
#
# Destroy calls POST /v2/stack/disable - the exact endpoint the onboarding UI's own "disable"
# control uses - which switches Knowledge Graph OFF FOR THE WHOLE STACK, not just this demo's
# objects. On a shared stack that already has Knowledge Graph on, or where some other tenant
# depends on it staying on, leave this false and onboard by hand (Observability > Knowledge
# Graph) instead; `knowledge_graph_enabled` below (the service-graph rule and the demo's trace
# configuration) works against a Knowledge Graph onboarded either way.
#
# The two tokens below exist only to hand to grafana_asserts_stack and are never used anywhere
# else, so they are created and destroyed with it.

resource "grafana_cloud_access_policy" "asserts" {
  provider = grafana.cloud
  count    = var.manage_knowledge_graph ? 1 : 0

  name         = "${local.prefix}-asserts"
  display_name = "${local.prefix} Knowledge Graph onboarding"
  region       = data.grafana_cloud_stack.this.region_slug
  scopes       = ["stacks:read", "metrics:read", "metrics:write"]

  dynamic "realm" {
    for_each = local.grafana_stack_realm
    content {
      type       = realm.value.type
      identifier = realm.value.identifier
    }
  }
}

resource "grafana_cloud_access_policy_token" "asserts" {
  provider = grafana.cloud
  count    = var.manage_knowledge_graph ? 1 : 0

  name             = "${local.prefix}-asserts"
  display_name     = "${local.prefix} Knowledge Graph onboarding"
  region           = data.grafana_cloud_stack.this.region_slug
  access_policy_id = grafana_cloud_access_policy.asserts[0].policy_id
}

# Cloud API service account (distinct from grafana_service_account.experiments in kubernetes.tf,
# which is a stack-local service account created through the stack's own Grafana API): Asserts
# stack onboarding installs dashboards and Grafana-managed alert rules with it, so it needs Admin.
resource "grafana_cloud_stack_service_account" "asserts" {
  provider = grafana.cloud
  count    = var.manage_knowledge_graph ? 1 : 0

  stack_slug = var.grafana_cloud_stack_slug
  name       = "${local.prefix}-asserts"
  role       = "Admin"
}

resource "grafana_cloud_stack_service_account_token" "asserts" {
  provider = grafana.cloud
  count    = var.manage_knowledge_graph ? 1 : 0

  stack_slug         = var.grafana_cloud_stack_slug
  name               = "${local.prefix}-asserts"
  service_account_id = grafana_cloud_stack_service_account.asserts[0].id
}

resource "grafana_asserts_stack" "this" {
  provider = grafana.stack
  count    = var.manage_knowledge_graph ? 1 : 0

  cloud_access_policy_token = grafana_cloud_access_policy_token.asserts[0].token
  grafana_token             = grafana_cloud_stack_service_account_token.asserts[0].key
}

# --- Service graph (var.knowledge_graph_enabled) -------------------------------------------------
#
# A custom service-graph relation so the in-app agents and the site show up as connected services.
# Tempo's service-graph metrics carry the service.namespace resource attribute as
# client_/server_service_namespace, which this demo sets to local.prefix (the default Kubernetes
# namespace has the same value). Ported from the original rule, which filtered on one asserts_env;
# this one is scoped by namespace only. Requires the Knowledge Graph to be initialized on the
# stack, by manage_knowledge_graph or by hand.
#
# Depends on the onboarding above only when both are enabled in the same apply (a fresh stack must
# finish onboarding before a rule file against it means anything); when manage_knowledge_graph is
# false there is nothing to depend on and this is a no-op.
resource "grafana_asserts_prom_rule_file" "service_graph" {
  provider   = grafana.stack
  count      = local.grafana_kg_enabled ? 1 : 0
  depends_on = [grafana_asserts_stack.this]

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

# --- Trace configuration (var.knowledge_graph_enabled) --------------------------------------------
#
# A dedicated, low-priority trace configuration so the Knowledge Graph resolves entity properties
# for THIS demo's services from the resource attributes the chart's in-namespace Alloy actually
# sets on trace spans, without touching Asserts' built-in default_config or any other stack's
# trace configuration on a shared stack. priority = 9000: every worked example in the provider's
# own docs uses priorities in the 1000-3000 range, so 9000 sorts after them (lower priority number
# wins) and this config only ever supplies mappings nothing more specific has already claimed for
# the matched entities - it can never override another tenant's or the stack default's mapping.
#
# match is scoped to Service entities in this demo's Kubernetes namespace (not otel_namespace: the
# app-level service.namespace resource attribute happens to equal var.namespace by default, but
# the k8s namespace property is set by the collector's k8sattributes processor regardless of
# app config, so it is the more robust selector on a stack running more than one deployment of
# this module).
#
# entity_property_to_trace_label_mapping verified against charts/touchline/templates/alloy.yaml's
# otelcol.processor.k8sattributes "apps" block and the apps' own OTEL_RESOURCE_ATTRIBUTES
# (touchline.resourceAttributes in _helpers.tpl): k8sattributes' pod_association resolves the
# sending pod from the OTLP connection and stamps k8s.namespace.name and k8s.pod.name as resource
# attributes on every metric, log and trace this demo emits (also k8s.node.name and
# k8s.deployment.name, unused here); the apps set only service.namespace and
# deployment.environment themselves. There is no k8s.container.name resource attribute on traces
# or metrics from this chart - only the separate stdout-log pipeline renames a Loki `container`
# label to that key for LOGS (see the otelcol.processor.transform "pod_logs" block in the same
# file). The container mapping below is kept because it is the correct OTel semantic-conventions
# attribute name and is harmless if no span carries it (Asserts leaves that one entity property
# unset rather than failing); pod is mapped at resource level, matching where this chart's
# collector actually puts it, not the provider docs' second example, which maps pod from a
# span-level label instead (unverified whether that difference matters to Asserts' own scoring).
resource "grafana_asserts_trace_config" "this" {
  provider = grafana.stack
  count    = local.grafana_kg_enabled ? 1 : 0

  name            = local.prefix
  priority        = 9000
  default_config  = false
  data_source_uid = local.grafana.datasource_traces

  match {
    property = "asserts_entity_type"
    op       = "="
    values   = ["Service"]
  }

  match {
    property = "namespace"
    op       = "="
    values   = [var.namespace]
  }

  entity_property_to_trace_label_mapping = {
    otel_service   = "resource.service.name"
    otel_namespace = "resource.service.namespace"
    namespace      = "resource.k8s.namespace.name"
    pod            = "resource.k8s.pod.name"
    container      = "resource.k8s.container.name"
  }
}
