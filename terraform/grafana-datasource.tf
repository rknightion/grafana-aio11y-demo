# The gateway's spend store as a Grafana datasource. Postgres runs in the agent host's docker compose
# network with no inbound path; Grafana reaches it through the PDC agent on the same network, so the
# host name is the compose service name.

# Read-only Postgres role for Grafana. The agent host's Postgres init creates grafana_ro with this
# password (agent-host secret key postgres_grafana_ro_password) and grants SELECT on the spend tables.
resource "random_password" "grafana_ro" {
  length  = 32
  special = false
}

resource "grafana_data_source" "spend" {
  provider = grafana.stack

  type          = "grafana-postgresql-datasource"
  name          = local.grafana.spend_datasource
  uid           = local.grafana.spend_datasource
  url           = "postgres:5432"
  username      = "grafana_ro"
  database_name = "gateway"

  private_data_source_connect_network_id = grafana_cloud_private_data_source_connect_network.this.pdc_network_id

  json_data_encoded = jsonencode({
    database        = "gateway"
    sslmode         = "disable" # traffic stays on the host's compose network behind the PDC tunnel
    postgresVersion = 1600
    timescaledb     = false
    maxOpenConns    = 5
  })

  secure_json_data_encoded = jsonencode({
    password = random_password.grafana_ro.result
  })
}
