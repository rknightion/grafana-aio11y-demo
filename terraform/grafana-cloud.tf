# Grafana Cloud control plane: the stack lookup, ingest access policies and tokens, and the Private
# Data source Connect (PDC) network. Everything here uses the grafana.cloud provider alias, which
# holds a Cloud access policy token (accesspolicies:read/write/delete, stacks:read).

data "grafana_cloud_stack" "this" {
  provider = grafana.cloud

  slug = var.grafana_cloud_stack_slug
}

locals {
  grafana_stack_realm = [{
    type       = "stack"
    identifier = data.grafana_cloud_stack.this.id
  }]
}

# Telemetry from the cluster (in-namespace Alloy), the gateway's forward_to, and the agento11y SDKs
# and Claude Code plugin. sigil:write is the Agent Observability ingest scope.
# Client token for the Claude Code agento11y plugin on the developer containers. It is pushed to
# every developer session, so it is never reused elsewhere and cannot read anything. metrics and
# traces write carry the plugin's own series (agento11y_* guard outcomes and generation cost).
resource "grafana_cloud_access_policy" "client" {
  provider = grafana.cloud

  name         = "${local.prefix}-client"
  display_name = "${local.prefix} demo Claude Code plugin"
  region       = data.grafana_cloud_stack.this.region_slug
  scopes       = ["sigil:write", "metrics:write", "traces:write"]

  dynamic "realm" {
    for_each = local.grafana_stack_realm
    content {
      type       = realm.value.type
      identifier = realm.value.identifier
    }
  }
}

resource "grafana_cloud_access_policy_token" "client" {
  provider = grafana.cloud

  name             = "${local.prefix}-client"
  region           = data.grafana_cloud_stack.this.region_slug
  access_policy_id = grafana_cloud_access_policy.client.policy_id
}

resource "grafana_cloud_access_policy" "ingest" {
  provider = grafana.cloud

  name         = "${local.prefix}-ingest"
  display_name = "${local.prefix} demo ingest"
  region       = data.grafana_cloud_stack.this.region_slug
  scopes       = ["metrics:write", "logs:write", "traces:write", "sigil:write"]

  dynamic "realm" {
    for_each = local.grafana_stack_realm
    content {
      type       = realm.value.type
      identifier = realm.value.identifier
    }
  }
}

resource "grafana_cloud_access_policy_token" "ingest" {
  provider = grafana.cloud

  name             = "${local.prefix}-ingest"
  display_name     = "${local.prefix} demo ingest"
  region           = data.grafana_cloud_stack.this.region_slug
  access_policy_id = grafana_cloud_access_policy.ingest.policy_id
}

# Amazon Data Firehose deliveries (CloudWatch metric stream and Bedrock invocation logs). Kept apart
# from the ingest token so the AWS side never holds a traces or Agent Observability credential.
resource "grafana_cloud_access_policy" "aws" {
  provider = grafana.cloud

  name         = "${local.prefix}-aws-firehose"
  display_name = "${local.prefix} demo AWS Firehose"
  region       = data.grafana_cloud_stack.this.region_slug
  scopes       = ["metrics:write", "logs:write"]

  dynamic "realm" {
    for_each = local.grafana_stack_realm
    content {
      type       = realm.value.type
      identifier = realm.value.identifier
    }
  }
}

resource "grafana_cloud_access_policy_token" "aws" {
  provider = grafana.cloud

  name             = "${local.prefix}-aws-firehose"
  display_name     = "${local.prefix} demo AWS Firehose"
  region           = data.grafana_cloud_stack.this.region_slug
  access_policy_id = grafana_cloud_access_policy.aws.policy_id
}

# PDC: the agent on the EC2 host dials out to Grafana Cloud, so the gateway's Postgres needs no
# inbound path. The network token is what the PDC agent signs in with.
resource "grafana_cloud_private_data_source_connect_network" "this" {
  provider = grafana.cloud

  name             = "${local.prefix}-agent-host"
  display_name     = "${local.prefix} agent host"
  region           = data.grafana_cloud_stack.this.region_slug
  stack_identifier = data.grafana_cloud_stack.this.id
}

resource "grafana_cloud_private_data_source_connect_network_token" "this" {
  provider = grafana.cloud

  name           = "${local.prefix}-agent-host"
  display_name   = "${local.prefix} agent host"
  region         = grafana_cloud_private_data_source_connect_network.this.region
  pdc_network_id = grafana_cloud_private_data_source_connect_network.this.pdc_network_id
}
