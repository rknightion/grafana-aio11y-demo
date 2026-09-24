# Agent host seam

The contract between the Terraform that renders the agent host (`terraform/aws-agent-host.tf`)
and the files in this directory. Change a name here only together with both sides.

## Template variables (`cloud-init.yaml.tftpl`, static)

user_data never changes with a knob or a credential; changing it replaces the host.

| Variable | Type | Meaning |
|---|---|---|
| `name` | string | Demo prefix; compose project name, `service.namespace` |
| `aws_region` | string | Secrets Manager, S3 and Bedrock region |
| `secret_arn` | string | The agent-host secret below |
| `images_registry`, `images_name_prefix`, `images_tag` | string | `<registry>/<name_prefix>gateway:<tag>` and `<registry>/<name_prefix>dev-workstation:<tag>`; the tag must be plain |
| `images_digests_json` | JSON | Optional `{gateway: "sha256:...", "dev-workstation": "sha256:..."}`; a pinned image is referenced as `<ref>:<tag>@<digest>` |
| `bundle_bucket`, `bundle_json` | string, JSON | The render bundle: `{host path: {key, sha256, mode}}` in the module-owned bucket. `agent-host-install-bundle` refuses any file whose SHA-256 differs |

The bundle is every file here that runs as root: `render/render.py`, `config/alloy.alloy`,
`config/postgres-bootstrap.sh` and `host/*`. Images are pulled only when missing, never re-pulled.

## Agent-host secret (Secrets Manager, JSON, re-read every 5 minutes)

Credentials: `cognito_client_secret`, `gateway_jwt_secret`, `gateway_admin_write_key` (32+
characters), `gateway_admin_read_key` (32+ characters), `postgres_password` (gateway role),
`postgres_grafana_ro_password`, `grafana_otlp_token` (metrics, logs and traces write: gateway
`forward_to` and host Alloy only), `agento11y_client_token` (generation, metrics and traces write: the
Claude Code plugin's generations and its own OTLP export, pushed to every client), `pdc_token`, `tls_ca_pem`, `tls_cert_pem` (leaf for
`gateway_hostname`), `tls_key_pem`, `developer_passwords` (`{name: password}`).

`config` holds every mutable knob:

| Key | Type | Meaning |
|---|---|---|
| `gateway_hostname` | string | `<prefix>-gateway.internal`; gateway URL is `https://<gateway_hostname>` (port 443) |
| `claude_code_version` | string | Claude Code release installed at container start |
| `agento11y_cli_version` | string | `latest` keeps the image's pinned build; a version installs that one. The plugin marketplace is pinned to the matching `plugins/agento11y/v<version>` tag |
| `developers` | list | `[{name, email, team, sub}]`, `sub` is the Cognito user's sub |
| `teams` | list | `["newsroom", ...]`, Cognito group names |
| `spend_caps` | object | `{organization: {period: usd}, groups: {team: {period: usd}}, users: {name: {period: usd}}}`, periods `daily`, `weekly`, `monthly` |
| `gateway_models` | list | `[{key, id, upstream_profile_arns_by_team: {team: arn}}]`, optional `upstream_profile_arn` |
| `team_model_allowlist` | map | `{team: [model key]}`; a listed team gets only those gateway models |
| `cognito_issuer`, `cognito_client_id`, `cognito_domain_url` | string | OIDC issuer, app client id, hosted UI base URL |
| `traffic_enabled` | bool | Developer sessions on or off |
| `session_interval_minutes` | number | Mean minutes between sessions per developer |
| `content_capture` | bool | Prompt, response and tool content in telemetry |
| `grafana_otlp_endpoint`, `grafana_otlp_username` | string | Grafana Cloud OTLP gateway base URL and instance id |
| `agento11y_endpoint`, `agento11y_tenant` | string | Agent Observability API URL and tenant id |
| `pdc_cluster`, `pdc_hosted_grafana_id` | string | PDC cluster slug and hosted Grafana (stack) id |
| `service_names` | map | `local.service_names`; uses `gateway` and `agent_host` |

The Cognito app client's callback URL must be `https://<gateway_hostname>/oauth/callback`.

The renderer writes each value to `/etc/agent-host/secrets/<consumer>/<key>`, mode 0400, owned by
the container uid that reads it, and removes files for secrets or developers no longer rendered.
The Postgres superuser password is generated on the host once and never leaves it. A change to
the secret re-renders within 5 minutes and recreates only the services whose inputs changed.

## Networks

| Network (bridge) | Members | Allowed |
|---|---|---|
| `<prefix>-core` (`ahcore0`, `172.30.252.0/24`) | gateway (`172.30.252.2`), postgres, one-shots, alloy, spend-caps | everything except IMDS, which only the gateway's fixed address may reach |
| `<prefix>-dev` (`ahdev0`, `172.30.253.0/24`) | developers, gateway (`172.30.253.2`) | developers: DNS, gateway:443, public internet. No IMDS, link-local, RFC 1918, CGNAT or host |
| `<prefix>-pdc` (`ahpdc0`) | pdc-agent, postgres | pdc: postgres:5432, DNS, public internet. Nothing private, no IMDS or host |

`host/agent-host-firewall` enforces the table in `DOCKER-USER` and `INPUT` (plus IPv6 drops for
`ahdev0` and `ahpdc0` in the ip6tables `FORWARD` and `INPUT` chains), before Docker starts
(a docker.service drop-in) and before every compose run; nothing starts if it fails.

## What the host provides to Grafana

- Postgres `postgres:5432` on the pdc network, database `gateway`, read-only role `grafana_ro`
  with SELECT on `spend`, `spend_limits`, `principal_emails` and `admin_audit` only (not `kv`
  or `_migrations`), reached through the PDC agent, no TLS.
- Container logs with `service_name=<prefix>-gateway` (gateway) or `<prefix>-agent-host`
  (everything else) and `service_namespace=<prefix>`; host and container metrics as
  `<prefix>-agent-host`.
- Developer telemetry through the gateway's `telemetry.forward_to`, with
  `OTEL_RESOURCE_ATTRIBUTES=service.namespace=<prefix>,team.name=<team>` and
  `AGENTO11Y_TAGS=service.namespace=<prefix>,team=<team>` pushed by the gateway policy.
