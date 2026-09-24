# Agent host

One EC2 instance (Amazon Linux 2023, `t4g.xlarge` by default) that plays a small engineering
team using Claude Code through the Claude apps gateway. Terraform creates it; nothing on it is
configured by hand.

```
             EC2 agent host (no inbound rules, SSM only)
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  dev-<name> x5 ──https──> gateway (<prefix>-gateway.internal:443) ──> Bedrock
 │   Claude Code             │   │                                            │
 │   + agento11y plugin      │   └─ telemetry.forward_to ──> Grafana Cloud OTLP
 │   + stdio MCP servers     └─ postgres <── pdc-agent <── Grafana (spend SQL) │
 │  alloy: container logs + host metrics ──> Grafana Cloud OTLP               │
 │  spend-caps (one shot): admin API caps per org, team and developer         │
 └───────────────────────────────────────────────────────────────────────────┘
```

## Boot

1. cloud-init (`cloud-init.yaml.tftpl`) writes the static `/etc/agent-host/host.json`, installs
   the render bundle (`render/`, `config/`, `host/`) from the module's S3 bucket after checking
   each file's SHA-256 against user_data, installs Docker, iptables and a pinned, checksum-verified
   compose plugin, and enables `agent-host.service` and `agent-host-refresh.timer`.
2. Docker starts only after `agent-host-firewall` has isolated the developer and PDC bridges (see
   Networks); the rules are re-applied after Docker starts and before every compose run.
3. `agent-host.service` applies security updates, then runs `/usr/local/sbin/agent-host-up`: it
   pipes the agent-host secret from Secrets Manager into `render.py` (host python, as root; no
   container image ever sees the whole secret) and runs `docker compose up`. Images are pulled only
   when missing, so a tag is never silently re-pulled.
4. The renderer writes `/etc/agent-host/compose.yaml`, `config/gateway.yaml` (secrets appear only
   as `${file:...}` references), and one 0400 file per secret under `secrets/<consumer>/`, owned by
   the uid of the container that reads it.
5. Every 5 minutes `agent-host-up --refresh` re-reads the secret. When it changed (a credential,
   or a knob in its `config` key such as `traffic_enabled`, spend caps or developers), it
   re-renders and `docker compose up` recreates only the services whose inputs changed. A knob
   change never replaces the host, so the Postgres spend ledger survives.

Compose order: `claude-install` downloads the pinned Claude Code release into a shared volume and
verifies it (GPG-signed manifest, then SHA-256), `postgres-bootstrap` creates the roles and
database, the gateway starts and migrates its tables, `postgres-grants` gives `grafana_ro` SELECT
on the four reporting tables, then `spend-caps` and the developer containers start.

## Networks

- `<prefix>-dev` (bridge `ahdev0`): the developer containers and the gateway. Developers reach
  the gateway on 443, DNS and the public internet only: no instance metadata (so no instance role
  credentials), no private or link-local address, no service on the host, not each other. Only
  the gateway's fixed address (`172.30.253.2`) may reach IMDS for its Bedrock credentials.
- `<prefix>-pdc` (bridge `ahpdc0`): the PDC agent and Postgres. The agent reaches
  `postgres:5432` and Grafana Cloud; nothing else private, so a Grafana user who edits the
  datasource cannot use it to reach the VPC or the gateway admin API.
- `<prefix>-core` (bridge `ahcore0`, `172.30.252.0/24`): everything else, with full egress
  except instance metadata, which only the gateway's fixed core address (`172.30.252.2`) may reach.
- IPv6 is off on every bridge, and the firewall also drops all IPv6 from `ahdev0` and `ahpdc0`.

Developer containers also run with every capability dropped and `no-new-privileges`.

No image contains Claude Code: the gateway and every developer container resolve the pinned
version at start and refuse a binary that fails verification.

## The login bot

Claude Code has no non-interactive way to sign in to a gateway, so each developer container
drives the real terminal UI (`apps/dev-workstation/bin/dev-login`):

1. starts `claude` in tmux; managed settings (`/etc/claude-code/managed-settings.json`, root owned,
   only `forceLoginMethod`, `forceLoginGatewayUrl` and `parentSettingsBehavior`) open the Cloud
   gateway screen, and the bot connects;
2. before trusting the gateway it checks the live certificate against the private CA and compares
   the fingerprint on screen with the Terraform-issued certificate, and refuses on a mismatch;
3. reads the user code, opens `/device?user_code=...` in headless Chromium, confirms the code,
   signs in on the Cognito hosted UI with the developer's generated password;
4. confirms the signed-in account and accepts the managed-settings approval dialog (telemetry
   endpoint, Agent Observability settings), then exits.

Only those dialogs are answered, each by its exact option text; any other prompt is left alone
and the attempt times out. Chromium trusts only the gateway's key (an SPKI pin of the issued
leaf); Cognito keeps normal certificate checks, and the password is typed only on the exact
Cognito domain from `cognito_domain_url`.

It is idempotent (`claude auth status` first), retries with backoff and shares a lock with the
traffic sessions. Credentials live on the per-developer `claude-home-<name>` volume, so restarts
keep the session. Cognito issues no `offline_access` refresh for the gateway, so sessions last
`session.ttl_hours` (12) and the loop signs in again when one lapses.

Manual fallback: `agent-host-login-links` on the host (`just login-developers` wraps it) prints each
developer's verification link and waits. Open it in a browser that reaches the gateway (see the
port forward below; the hostname must resolve to 127.0.0.1 and the forward must use local port
443, because Cognito redirects to `https://<gateway_hostname>/oauth/callback`).

## Traffic

With `traffic_enabled`, each developer runs `dev-session` every `session_interval_minutes`
(jittered): a random prompt from `prompts/` (70% written for the developer's team, about 20% PII
probes that the preflight deny guard should block), a model weighted mostly towards Haiku within
the team's allowed models, `--max-budget-usd 0.30`, and one JSON result line in the container log
(`event=dev_session`, with `guard_blocked` for blocked probes). Sessions auto-approve only the
tools the prompts need (read-only git plus clone/reset/checkout, file tools, python3, node, jq
and the MCP servers); no curl, rm, npm or npx.

## Troubleshooting (SSM)

```bash
id=$(terraform output -raw agent_host_instance_id)
aws ssm start-session --target "$id"          # shell as ssm-user; sudo -i for root

sudo systemctl status agent-host              # boot and render
sudo journalctl -u agent-host -b              # agent-host-up output
cd /etc/agent-host && sudo docker compose ps
sudo docker compose logs -f gateway           # audit JSON (evt=...) and [gateway] lines
sudo docker compose logs dev-alex-morgan      # login bot and session results
sudo docker compose exec dev-alex-morgan claude auth status --text
sudo docker compose exec dev-alex-morgan dev-login --force
sudo agent-host-up                            # re-fetch the secret, re-render, reconcile
sudo systemctl list-timers agent-host-refresh # the 5-minute secret re-read
sudo iptables -S AGENT-HOST-FWD               # dev/pdc isolation rules
```

Gateway from your laptop (loopback-published on the host as 8443):

```bash
aws ssm start-session --target "$id" --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=8443,localPortNumber=8443
curl --cacert ca.pem --resolve <prefix>-gateway.internal:8443:127.0.0.1 \
  https://<prefix>-gateway.internal:8443/readyz
```

`ca.pem` is `/etc/agent-host/config/ca.pem` on the host. Spend caps and effective spend:
`GET /v1/organizations/spend_limits` and `/v1/organizations/spend_limits/effective` with the read
key from `/etc/agent-host/secrets/gateway/gateway_admin_read_key` as `x-api-key`.

Common failures:

| Symptom | Look at |
|---|---|
| `agent-host.service` failed | journal: firewall, secret read (IAM), render (a bad `config` value is named), image pull (registry or tag) |
| cloud-init failed early | `/var/log/cloud-init-output.log`: `agent-host-install-bundle` (S3 read or a SHA-256 mismatch) |
| gateway restarting | `docker compose logs gateway`: the last line names the bad field, Postgres or OIDC discovery |
| `claude-install` failed | release download or signature/checksum mismatch; nothing runs until it passes |
| login bot `giving up` | the last screen is in the log; Cognito error text appears as `browser: ...` |
| no gateway spend in Grafana | `docker compose logs pdc-agent postgres-grants` |
| sessions `rc=124` | Bedrock access (model access form, profile ARNs, instance role) |

## Security notes

- Nothing listens on the VPC; the gateway port is published on 127.0.0.1 only.
- The gateway pushes the Agent Observability client token to signed-in clients as managed
  `env`; any demo developer session can read it. It writes generations and the plugin's own
  metrics and traces to the demo stack, and is not shared with anything else.
  The ingest token (metrics, logs, traces) stays with the gateway's `forward_to` and host Alloy.
- Host Alloy mounts the Docker socket and the host root read-only, so it is root-equivalent on
  the host; it is Grafana's own pinned image and holds only the ingest token.
- The private CA has no name constraints (the Terraform tls provider cannot set them) but
  `max_path_length = 0`, is trusted only inside the developer containers, and its key exists only
  in Terraform state.
- With `content_capture` on, prompts, responses and tool content go to Grafana Cloud. The
  containers only run demo work against public repositories and fictional data.
