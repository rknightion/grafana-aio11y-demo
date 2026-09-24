# Coding agents: the agent host

The coding-agent half of the demo is one EC2 instance playing a small engineering team. It runs
the Claude apps gateway, its Postgres, a PDC agent, a host Alloy and one Claude Code container per
developer, all under docker compose. [agent-host/README.md](https://github.com/rknightion/grafana-aio11y-demo/blob/main/agent-host/README.md) covers the
boot sequence and the files in detail; this page is the operator's view.

## What runs where

| Container | Role |
|---|---|
| `gateway` | Claude apps gateway on 443 inside the compose network, hostname `touchline-gateway.internal`, TLS from a private CA Terraform generates. Published on the host at `127.0.0.1:8443` only. |
| `postgres` | the gateway's store: sessions, spend counters, caps, admin audit |
| `pdc-agent` | outbound tunnel so Grafana can query Postgres (datasource `touchline-gateway-spend`) |
| `alloy` | ships container logs and host metrics to Grafana Cloud |
| `spend-caps` | one-shot: sets the caps from `spend_caps` through the gateway admin API |
| `dev-<name>` | one per developer: Claude Code, the login bot, the traffic loop, local stdio MCP servers |
| `claude-install` | one-shot: downloads the pinned Claude Code release (`claude_code_version`) and verifies its signature and checksum |

Nothing listens on the VPC. You reach the host with SSM Session Manager.

```bash
id=$(tofu -chdir=examples/complete output -raw agent_host_instance_id)
aws ssm start-session --target "$id"
cd /etc/agent-host && sudo docker compose ps
```

## Sign-in

Claude Code has no non-interactive way to sign in to a gateway, so each developer container runs a
login bot at start. It drives the real Claude Code terminal UI in tmux, checks the gateway
certificate against the private CA, opens the device-verification page in headless Chromium, and
signs in on the Cognito hosted UI with the developer's generated password. Credentials persist on
a per-developer volume, so restarts keep the session.

Gateway sessions last 12 hours. Cognito issues no refresh token for this flow, so the traffic loop
signs a developer in again when a session lapses.

The bot is tested against the pinned `claude_code_version`. If you change that version and the
bot stops working, use the manual fallback and report the version.

### Manual fallback: `just login-developers`

```bash
just login-developers          # uses examples/complete by default; dir=<root> for another root
```

This opens an SSM session on the host and runs `agent-host-login-links`, which prints each
developer's verification link and waits until the sign-ins complete. The links point at
`https://touchline-gateway.internal/device?...`, and after the Cognito sign-in the browser is sent
back to `https://touchline-gateway.internal/oauth/callback` on port 443. To open them from your
laptop, run `just login-tunnel` in a second terminal. It:

1. forwards local port **443** (not 8443) to the gateway over SSM
   (`aws ssm start-session ... --parameters portNumber=8443,localPortNumber=443`); binding a port
   below 1024 may need `sudo` on Linux;
2. prints the SPKI pin of the gateway's leaf certificate (from the `gateway_cert_pem` output) and
   opens a throwaway Chrome or Chromium profile (`--user-data-dir` in a new temporary directory)
   started with `--ignore-certificate-errors-spki-list=<pin>` and
   `--host-resolver-rules="MAP touchline-gateway.internal 127.0.0.1"`. That profile accepts only
   the gateway's own key and resolves only the gateway's name to the tunnel. Nothing is added to
   `/etc/hosts` or to any system or browser trust store. If no Chrome or Chromium is found, the
   recipe prints the full command to start one yourself;
3. closes the browser and deletes the profile when you stop the tunnel with Ctrl-C.

Do not add the demo's private CA (`gateway_ca_pem`) to your system or browser trust store: the
Terraform provider cannot name-constrain it, so a trusted copy could vouch for any hostname, and
its private key sits in Terraform state. If you did trust it on an earlier version of these
instructions, remove it (macOS: Keychain Access, delete the "touchline demo private CA"
certificate; Linux: remove the file you added under `/usr/local/share/ca-certificates/` and run
`update-ca-certificates`), and remove any `touchline-gateway.internal` line from `/etc/hosts`.

Then open each link in that browser and sign in as the developer named in it. Usernames are in
`tofu output developers`, passwords in `tofu output -json developer_passwords`.

You can also sign one developer in from inside the host:
`sudo docker compose exec dev-alex-morgan dev-login --force`.

## Reaching the gateway: `just gateway-tunnel`

```bash
just gateway-tunnel            # forwards localhost:8443 to the gateway on the host
```

Then save the CA for curl (a file you pass to `--cacert`, never a trust store entry):
`tofu -chdir=examples/complete output -raw gateway_ca_pem > ca.pem`, and:

```bash
curl --cacert ca.pem --resolve touchline-gateway.internal:8443:127.0.0.1 \
  https://touchline-gateway.internal:8443/readyz

curl --cacert ca.pem --resolve touchline-gateway.internal:8443:127.0.0.1 \
  -H "x-api-key: $(tofu -chdir=examples/complete output -raw gateway_admin_read_key)" \
  https://touchline-gateway.internal:8443/v1/organizations/spend_limits/effective
```

The read key shows caps and spend. The write key stays on the host
(`/etc/agent-host/secrets/gateway/gateway_admin_write_key`).

## Developers and teams

Defaults: five developers in three teams.

| Developer | Team |
|---|---|
| alex.morgan | newsroom |
| priya.shah | newsroom |
| sam.okafor | trading |
| jordan.lee | trading |
| casey.nguyen | platform |

Each team is a Cognito group, a gateway policy (managed settings by group) and a set of Bedrock
application inference profiles, one per model. Developer telemetry carries the team as
`user.groups`, and the gateway also stamps `team.name` in the resource attributes.

To change them, set the module inputs and apply:

```hcl
teams = ["newsroom", "trading", "platform", "data"]

developers = [
  { name = "alex.morgan", team = "newsroom" },
  { name = "robin.patel", team = "data" },
  # ...
]
```

- `name` is a stable key (letters, digits, dots). Email is `<name>@<developer_email_domain>`.
- Every developer's team must be in `teams` (a precondition checks this).
- **Keep `newsroom`, `trading` and `platform` in `teams`.** The in-app agents are assigned to those
  three teams and call their inference profiles.
- The trading team is limited to Haiku at the gateway through `team_model_allowlist` (default
  `{ trading = ["haiku"] }`). A team left out of `team_model_allowlist` gets every
  `gateway_models` entry.
- The developer list, teams, spend caps and `team_model_allowlist` live in the agent-host secret's
  `config` key, not in the host's user data. An apply that changes them updates the secret; the
  host re-reads it within 5 minutes and recreates only the containers whose settings changed, with
  no host replacement and no interruption to the Postgres spend ledger. The login bot signs in any
  developer whose container was recreated.

## Spend caps

The gateway enforces caps in USD per period (`daily`, `weekly`, `monthly`), per organization, per
group (team) and per developer. The organization cap is a per-seat default, and the most
restrictive cap that applies wins. A developer over a cap gets HTTP 429 with the message
"touchline demo spend cap reached".

Defaults:

```hcl
spend_caps = {
  organization = { daily = 20 }                  # every developer
  groups       = { trading = { daily = 5 } }     # trading developers
  users        = { "casey.nguyen" = { daily = 2 } }
}
```

Omitting a key keeps its default; set it to `{}` to remove that level. The `spend-caps` container
applies them at every boot. Spend and caps appear on the gateway dashboard's *Spend store* tab
and the Claude Code dashboard's *Gateway spend* tab, and the gateway spend alert fires at 5% of
the organization daily cap.

Gateway spend is the gateway's own estimate from token counts, a circuit breaker rather than a
Bedrock invoice. Each unattended session also has a hard `--max-budget-usd 0.30`.

## Traffic

With `traffic_enabled = true`, each developer runs a scripted session every
`developer_session_interval_minutes` (20 by default, jittered): usually a prompt written for their
team, sometimes a general coding task, and about one in five a PII probe that the preflight deny
guard should block. Prompts are in [agent-host/prompts](https://github.com/rknightion/grafana-aio11y-demo/tree/main/agent-host/prompts). Models are
weighted towards Haiku within the team's allowed models. Each session writes one JSON result line
to the container log (`event=dev_session`).

Run one session by hand:

```bash
sudo docker compose exec dev-priya-shah dev-session                       # random prompt
sudo docker compose exec dev-priya-shah dev-session /opt/agent-host/prompts/21-best-price-table.txt
```

## What the gateway pushes

Per team, through managed settings: Claude Code's OpenTelemetry exporters (the gateway forwards
client telemetry to the Grafana Cloud OTLP gateway with `telemetry.forward_to`), content logging
switches (from `content_capture`), resource attributes scoping everything to `service.namespace=touchline`,
the Agent Observability plugin and its tags, MCP servers, and the model list. The developer
containers carry only the three managed settings needed to find and sign in to the gateway.
