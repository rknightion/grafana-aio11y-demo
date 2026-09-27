#!/usr/bin/env python3
"""Render the agent host's docker compose project from host.json and the agent-host secret.

Runs on the host as root with the host's own python3, from the copy cloud-init wrote out of
user_data (never from a pulled image):

    aws secretsmanager get-secret-value ... --query SecretString --output text \
      | python3 /opt/agent-host/render/render.py --vars /etc/agent-host/host.json \
          --secret-stdin --out /etc/agent-host

Inputs
  host.json   static boot values from user_data (agent-host/SEAM.md)
  stdin       the agent-host secret JSON; its `config` key holds every mutable knob

Outputs under --out
  compose.yaml                  the compose project
  config/gateway.yaml           Claude apps gateway config (no secret values, only ${file:...} refs)
  config/managed-settings.json  developer-side managed settings (gateway sign-in only)
  config/alloy.alloy, config/postgres-bootstrap.sh   copied from the bundle
  config/ca.pem, config/gateway-cert.pem             public TLS material
  secrets/<consumer>/<name>     one file per secret, 0400, owned by the consumer's container uid

Every service carries an `agent-host.inputs` label hashing the files it mounts, so
`docker compose up` recreates exactly the services whose config or secrets changed. --check
renders without chown (local testing).
"""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import sys

try:
    import yaml

    def dump(obj):
        return yaml.safe_dump(obj, sort_keys=False, width=120)
except ImportError:  # JSON is valid YAML for both compose and the gateway
    def dump(obj):
        return json.dumps(obj, indent=2) + "\n"

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_SRC = os.path.join(os.path.dirname(HERE), "config")

# Container uids that read secret files (bind mounts keep host ownership and mode).
UID = {"gateway": 10001, "developer": 1000, "pdc": 30000, "root": 0}

# Third-party images, pinned by tag and multi-arch index digest.
IMAGES = {
    "postgres": "postgres:17.11-bookworm@sha256:639ab7ceb90e13123085b741fb31ef493fba25463002f6da665352e7b534b652",
    "alloy": "grafana/alloy:v1.19.2@sha256:b8ec653c44235fbe910879145dac3597d66b0aaecf60bcbbe82580767771a839",
    "pdc": "grafana/pdc-agent:0.0.65@sha256:ce14c6c3d7eb1b288e538c0a590730914c2fea97d6fe54a18f32b417e7b56297",
}

# The agento11y release the dev-workstation image ships (AGENTO11Y_VERSION in its Dockerfile).
# agento11y_cli_version "latest" means this one; the plugin marketplace is pinned to its tag.
AGENTO11Y_IMAGE_VERSION = "0.48.0"

# Networks. Bridge names are fixed so agent-host-firewall can match them before Docker starts;
# keep them, the subnets and the GATEWAY_*_IP addresses in sync with agent-host/host/agent-host-firewall.
#   core  gateway, postgres, one-shots, alloy, spend-caps (trusted, full egress; only the
#         gateway's fixed address may reach IMDS)
#   dev   developer containers + gateway only; no IMDS, no private addresses, no host
#   pdc   pdc-agent + postgres only; pdc may reach postgres:5432 and the internet, nothing else
BRIDGES = {"core": "ahcore0", "dev": "ahdev0", "pdc": "ahpdc0"}
CORE_SUBNET = "172.30.252.0/24"
CORE_DYNAMIC_RANGE = "172.30.252.128/25"  # dynamic addresses never collide with the gateway's
CORE_BRIDGE_IP = "172.30.252.1"
GATEWAY_CORE_IP = "172.30.252.2"
DEV_SUBNET = "172.30.253.0/24"
DEV_DYNAMIC_RANGE = "172.30.253.128/25"  # dynamic addresses never collide with the gateway's
DEV_BRIDGE_IP = "172.30.253.1"
GATEWAY_DEV_IP = "172.30.253.2"

GATEWAY_PORT = 443  # public_url carries no port, matching the Cognito callback URL
ADMIN_UI_LOCAL_PORT = 8443  # published on the host loopback only, for SSM port forwarding
PERIODS = ("daily", "weekly", "monthly")

# Traffic mix: relative weight per model family (mostly Haiku, some Sonnet).
MODEL_FAMILY_WEIGHTS = {"haiku": 75, "sonnet": 20, "opus": 5}

PRIVATE_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128", "fc00::/7"]

HOST_KEYS = ["name", "aws_region", "images_registry", "images_name_prefix", "images_tag"]
CONFIG_KEYS = [
    "gateway_hostname", "claude_code_version", "agento11y_cli_version", "developers", "teams",
    "spend_caps", "gateway_models", "team_model_allowlist", "cognito_issuer", "cognito_client_id",
    "cognito_domain_url", "traffic_enabled", "session_interval_minutes", "content_capture",
    "grafana_otlp_endpoint", "grafana_otlp_username", "agento11y_endpoint", "agento11y_tenant",
    "pdc_cluster", "pdc_hosted_grafana_id", "service_names",
]
SECRET_KEYS = [
    "cognito_client_secret", "gateway_jwt_secret", "gateway_admin_write_key", "gateway_admin_read_key",
    "postgres_password", "postgres_grafana_ro_password", "grafana_otlp_token", "agento11y_client_token",
    "pdc_token", "tls_ca_pem", "tls_cert_pem", "tls_key_pem", "developer_passwords",
]


def fail(msg):
    sys.exit(f"render: {msg}")


def file_ref(path):
    """A gateway.yaml secret reference, resolved by the gateway at boot."""
    return "$" + "{file:" + path + "}"


def truthy(value):
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def as_obj(value):
    return json.loads(value) if isinstance(value, str) else value


def load(vars_path, s):
    with open(vars_path, encoding="utf-8") as fh:
        host = json.load(fh)
    config = as_obj(s.get("config") or {})
    v = {**config, **host}  # static boot values win over the secret
    missing = [k for k in HOST_KEYS if k not in host] + [k for k in CONFIG_KEYS if k not in config]
    if missing:
        fail(f"missing {', '.join(missing)} (host.json / secret config)")
    for key in ("developers", "teams", "spend_caps", "gateway_models", "team_model_allowlist", "service_names"):
        v[key] = as_obj(v[key])
    if not re.fullmatch(r"\d+\.\d+\.\d+", str(v["claude_code_version"])):
        fail(f"claude_code_version must be X.Y.Z, got {v['claude_code_version']!r}")
    return v


def repo_image(v, image):
    """<registry>/<name_prefix><image>:<tag>, with @<digest> when images_digests pins this image."""
    tag = str(v["images_tag"])
    if "@" in tag:
        fail("images_tag must be a plain tag; pin digests per image with images_digests")
    ref = f"{v['images_registry'].rstrip('/')}/{v['images_name_prefix']}{image}:{tag}"
    digest = (v.get("images_digests") or {}).get(image)
    if digest:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            fail(f"images_digests.{image} is not a sha256 digest")
        ref += "@" + digest
    return ref


def agento11y_version(v):
    ver = str(v["agento11y_cli_version"] or "latest").lstrip("v")
    ver = AGENTO11Y_IMAGE_VERSION if ver == "latest" else ver
    if not re.fullmatch(r"\d+\.\d+\.\d+", ver):
        fail(f"agento11y_cli_version must be latest or X.Y.Z, got {ver!r}")
    return ver


def model_keys_for_team(v, team):
    keys = [m["key"] for m in v["gateway_models"]]
    allowed = (v["team_model_allowlist"] or {}).get(team)
    if allowed is None:
        return keys
    narrowed = [k for k in keys if k in allowed]
    if not narrowed:
        fail(f"team_model_allowlist leaves team {team!r} with no gateway model")
    return narrowed


def model_ids(v, keys):
    by_key = {m["key"]: m["id"] for m in v["gateway_models"]}
    return [by_key[k] for k in keys]


def model_weights(ids):
    out = []
    for mid in ids:
        weight = next((w for fam, w in MODEL_FAMILY_WEIGHTS.items() if fam in mid), 10)
        out.append(f"{mid}={weight}")
    return ",".join(out)


def upstream_arn(model):
    """One application inference profile per model for the gateway.

    The gateway routes by model id and upstream name only; it has no per-group upstream mapping,
    so every team's requests use one profile per model. Prefer an explicit gateway profile, then
    the platform team's, then the first team's in sorted order.
    """
    if model.get("upstream_profile_arn"):
        return model["upstream_profile_arn"]
    by_team = model["upstream_profile_arns_by_team"]
    for team in ("platform", *sorted(by_team)):
        if team in by_team:
            return by_team[team]
    fail(f"model {model['key']} has no inference profile")


def model_label(mid):
    """claude-haiku-4-5 -> Claude Haiku 4.5, claude-sonnet-5 -> Claude Sonnet 5."""
    words, version = [], []
    for part in mid.split("-"):
        (version if part.isdigit() else words).append(part)
    return " ".join(w.capitalize() for w in words) + (" " + ".".join(version) if version else "")


def gateway_config(v):
    name = v["name"]
    content = truthy(v["content_capture"])
    otlp_user_matches_tenant = str(v["grafana_otlp_username"]) == str(v["agento11y_tenant"])

    env = {
        # Traces need this on every client; the gateway does not push it.
        "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",
        # Cumulative is load-bearing: with the delta default a short -p session's metrics never
        # show up as Prometheus series.
        "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "cumulative",
        "OTEL_METRIC_EXPORT_INTERVAL": "15000",
        # Without it every MCP server and tool name is exported as "custom". It also logs tool
        # input and Bash commands, which is why the developer containers run demo work only.
        "OTEL_LOG_TOOL_DETAILS": "1",
        "OTEL_RESOURCE_ATTRIBUTES": f"service.namespace={name}",
        "DISABLE_AUTOUPDATER": "1",
        # Agent Observability plugin: its hooks read these from the Claude Code process. The
        # token is the dedicated client token, never the gateway/Alloy ingest token.
        "AGENTO11Y_ENDPOINT": v["agento11y_endpoint"],
        "AGENTO11Y_PROTOCOL": "http",
        "AGENTO11Y_AUTH_MODE": "basic",
        "AGENTO11Y_AUTH_TENANT_ID": str(v["agento11y_tenant"]),
        "AGENTO11Y_AUTH_TOKEN": file_ref("/run/secrets/agento11y_client_token"),
        "AGENTO11Y_GUARDS_ENABLED": "true",
        # The 1500 ms default leaves Cloud too little time for an LLM-judge guard; a timeout
        # fails open silently.
        "AGENTO11Y_GUARDS_TIMEOUT_MS": "5000",
        "AGENTO11Y_AUTO_UPDATE": "false",
        # Evaluation rules select the demo's generations by this tag. Guard calls carry no tags
        # (plugin v0.48.0), so the guards select the demo by this agent name instead; the plugin
        # appends /<subagent> for subagents.
        "AGENTO11Y_TAGS": f"service.namespace={name}",
        "AGENTO11Y_AGENT_NAME": f"claude-code/{name}",
        "AGENTO11Y_CONTENT_CAPTURE_MODE": "full" if content else "metadata_only",
    }
    if content:
        env.update({
            "OTEL_LOG_USER_PROMPTS": "1",
            "OTEL_LOG_ASSISTANT_RESPONSES": "1",
            "OTEL_LOG_TOOL_CONTENT": "1",
            # Prompts are otherwise redacted from conversations even in full mode.
            "AGENTO11Y_REDACT_INPUT_MESSAGES": "false",
        })
    if otlp_user_matches_tenant:
        # The plugin's own metrics and spans (hook rule outcomes, generation cost) authenticate as
        # AGENTO11Y_AUTH_TENANT_ID with the same client token (generation, metrics, traces write).
        env["AGENTO11Y_OTEL_EXPORTER_OTLP_ENDPOINT"] = v["grafana_otlp_endpoint"]
        env["AGENTO11Y_OTEL_AUTH_TOKEN"] = file_ref("/run/secrets/agento11y_client_token")

    all_ids = model_ids(v, [m["key"] for m in v["gateway_models"]])
    base_cli = {
        "availableModels": all_ids,
        "enforceAvailableModels": True,
        # Remote MCP servers every developer gets with no local config (http/sse only).
        "managedMcpServers": {
            "context7": {"type": "http", "url": "https://mcp.context7.com/mcp"},
            "deepwiki": {"type": "http", "url": "https://mcp.deepwiki.com/mcp"},
        },
        # Pinned to the release tag of the CLI the containers run (dev-loop adds the same ref).
        "extraKnownMarketplaces": {
            "agento11y": {"source": {"source": "github", "repo": "grafana/agento11y",
                                     "ref": f"plugins/agento11y/v{agento11y_version(v)}"}},
        },
        "enabledPlugins": {"agento11y-claude-code@agento11y": True},
        "env": env,
    }

    policies = []
    for team in v["teams"]:
        team_ids = model_ids(v, model_keys_for_team(v, team))
        cli = {
            "env": {
                "OTEL_RESOURCE_ATTRIBUTES": f"service.namespace={name},team.name={team}",
                "AGENTO11Y_TAGS": f"service.namespace={name},team={team}",
            },
        }
        if team_ids != all_ids:
            cli["availableModels"] = team_ids
        policies.append({"match": {"groups": [team]}, "cli": cli})
    policies.append({"match": {}, "cli": base_cli})

    return {
        "listen": {
            "host": "0.0.0.0",
            "port": GATEWAY_PORT,
            "public_url": f"https://{v['gateway_hostname']}",
            "tls": {"cert": "/run/secrets/tls_cert_pem", "key": "/run/secrets/tls_key_pem"},
        },
        "oidc": {
            "issuer": v["cognito_issuer"],
            "client_id": v["cognito_client_id"],
            "client_secret": file_ref("/run/secrets/cognito_client_secret"),
            # Cognito rejects offline_access, so there is no silent refresh: sessions last
            # session.ttl_hours and the login bot signs developers in again when they lapse.
            "scopes": ["openid", "profile", "email"],
            "groups_claim": "cognito:groups",
            "allowed_groups": list(v["teams"]),
        },
        "session": {"jwt_secret": file_ref("/run/secrets/gateway_jwt_secret"), "ttl_hours": 12},
        "store": {
            "postgres_url": "postgresql://gateway@postgres:5432/gateway",
            "password": file_ref("/run/secrets/postgres_password"),
            "max_connections": 10,
        },
        "upstreams": [{"name": "bedrock", "provider": "bedrock", "region": v["aws_region"], "auth": {}}],
        "auto_include_builtin_models": False,
        "models": [
            {
                "id": m["id"],
                "label": model_label(m["id"]),
                "upstream_model": {"bedrock": upstream_arn(m)},
            }
            for m in v["gateway_models"]
        ],
        "managed": {"policies": policies},
        "admin": {
            "write_keys": [{"id": "spend-caps", "key": file_ref("/run/secrets/gateway_admin_write_key")}],
            "read_keys": [{"id": "reporting", "key": file_ref("/run/secrets/gateway_admin_read_key")}],
            "group_limit_mode": "min",
            "blocked_message": f"{name} demo spend cap reached; see the gateway spend dashboard",
        },
        "telemetry": {
            "forward_to": [{
                "url": v["grafana_otlp_endpoint"],
                "headers": {"Authorization": file_ref("/run/secrets/otlp_authorization")},
                "metrics": True,
                "logs": True,
                "traces": True,
            }],
        },
        "access_control": {"allow_cidrs": PRIVATE_CIDRS},
        # Five developers sign in from five container addresses; retries after a failed bot run
        # should not trip the per-IP defaults (30 starts and 10 code submissions per 10 minutes).
        "rate_limits": {
            "device_authorization": {"max": 60, "window_seconds": 600},
            "device_verify": {"max": 30, "window_seconds": 600},
        },
    }


def spend_caps_cents(v):
    """Normalise spend_caps (whole USD per period) into admin API payloads, in cents."""
    caps = v["spend_caps"] or {}
    subs = {d["name"]: d.get("sub") for d in v["developers"]}
    out = []

    def add(scope, periods, label):
        for period, usd in (periods or {}).items():
            if period not in PERIODS:
                fail(f"spend cap {label} has unknown period {period!r}")
            if usd is None:
                continue
            out.append({"scope": scope, "amount": str(int(round(float(usd) * 100))), "period": period})

    add({"type": "organization"}, caps.get("organization"), "organization")
    for group, periods in (caps.get("groups") or {}).items():
        add({"type": "rbac_group", "rbac_group_id": group}, periods, f"group {group}")
    for user, periods in (caps.get("users") or {}).items():
        if not subs.get(user):
            fail(f"spend cap for unknown developer {user!r}")
        add({"type": "user", "user_id": subs[user]}, periods, f"user {user}")
    return out


def dev_slug(dev):
    return dev["name"].replace(".", "-")


def compose_project(v, files, host_root="/etc/agent-host"):
    """The compose project. `files` maps out-relative paths to rendered content (for hashing)."""
    name = v["name"]
    gw_image = repo_image(v, "gateway")
    dev_image = repo_image(v, "dev-workstation")
    host = v["gateway_hostname"]
    svc = v["service_names"]
    gateway_url = f"https://{host}"
    cfg = f"{host_root}/config"

    top_secrets = {}

    def use(consumer, keys):
        names = []
        for key in keys:
            sname = f"{consumer}_{key}".replace(".", "_")
            top_secrets[sname] = {"file": f"{host_root}/secrets/{consumer}/{key}"}
            names.append({"source": sname, "target": key})
        return names

    hardening = {"security_opt": ["no-new-privileges:true"], "cap_drop": ["ALL"]}
    label = lambda service_name, role: {"agent-host.service_name": service_name, "agent-host.role": role}  # noqa: E731
    host_label = label(svc["agent_host"], "infra")
    logging = {"driver": "json-file", "options": {"max-size": "20m", "max-file": "5"}}
    base = {"pull_policy": "missing", "logging": logging}  # never re-pull a tag silently

    services = {
        "claude-install": {
            "image": gw_image,
            "user": "0:0",
            "entrypoint": ["/usr/local/bin/claude-install"],
            "command": [v["claude_code_version"], "/opt/claude-code"],
            "volumes": ["claude-code:/opt/claude-code"],
            "networks": ["core"],
            "restart": "no",
            "labels": host_label,
        },
        "postgres": {
            "image": IMAGES["postgres"],
            "environment": {
                "POSTGRES_USER": "postgres",
                "POSTGRES_DB": "postgres",
                "POSTGRES_PASSWORD_FILE": "/run/secrets/superuser_password",
            },
            "secrets": use("postgres", ["superuser_password"]),
            "volumes": ["pgdata:/var/lib/postgresql/data"],
            "networks": ["core", "pdc"],
            "healthcheck": {
                "test": ["CMD-SHELL", "pg_isready -U postgres -d postgres -q"],
                "interval": "5s", "timeout": "3s", "retries": 30,
            },
            "restart": "unless-stopped",
            "labels": host_label,
        },
        "postgres-bootstrap": {
            "image": IMAGES["postgres"],
            "entrypoint": ["bash", "/bootstrap/postgres-bootstrap.sh", "before-gateway"],
            "volumes": [f"{cfg}/postgres-bootstrap.sh:/bootstrap/postgres-bootstrap.sh:ro"],
            "secrets": use("postgres", ["superuser_password", "postgres_password", "postgres_grafana_ro_password"]),
            "networks": ["core"],
            "depends_on": {"postgres": {"condition": "service_healthy"}},
            "restart": "no",
            "labels": host_label,
        },
        "gateway": {
            "image": gw_image,
            "user": f"{UID['gateway']}:{UID['gateway']}",
            "read_only": True,
            "tmpfs": ["/tmp"],
            # Bind 443 as non-root so public_url needs no port.
            "sysctls": {"net.ipv4.ip_unprivileged_port_start": "0"},
            "environment": {
                "CLAUDE_CODE_VERSION": v["claude_code_version"],
                "AWS_REGION": v["aws_region"],
                "AWS_DEFAULT_REGION": v["aws_region"],
                "CLAUDE_GATEWAY_LOG_LEVEL": "info",
            },
            "volumes": [
                f"{cfg}/gateway.yaml:/etc/claude/gateway.yaml:ro",
                "claude-code:/opt/claude-code:ro",
            ],
            "secrets": use("gateway", [
                "cognito_client_secret", "gateway_jwt_secret", "gateway_admin_write_key",
                "gateway_admin_read_key", "postgres_password", "agento11y_client_token",
                "otlp_authorization", "tls_cert_pem", "tls_key_pem",
            ]),
            # The fixed addresses are the only ones agent-host-firewall lets reach IMDS from the
            # core and dev bridges (Bedrock credentials come from the instance role).
            "networks": {
                "core": {"aliases": [host], "ipv4_address": GATEWAY_CORE_IP},
                "dev": {"aliases": [host], "ipv4_address": GATEWAY_DEV_IP},
            },
            # Loopback only: reach it with an SSM port-forwarding session, never from the VPC.
            "ports": [f"127.0.0.1:{ADMIN_UI_LOCAL_PORT}:{GATEWAY_PORT}"],
            "healthcheck": {
                "test": ["CMD", "curl", "-fsS", "-o", "/dev/null", "--cacert", "/run/secrets/tls_cert_pem",
                         "--resolve", f"{host}:{GATEWAY_PORT}:127.0.0.1", f"https://{host}/readyz"],
                "interval": "10s", "timeout": "5s", "retries": 6, "start_period": "60s",
            },
            "depends_on": {
                "claude-install": {"condition": "service_completed_successfully"},
                "postgres-bootstrap": {"condition": "service_completed_successfully"},
            },
            "restart": "unless-stopped",
            "stop_grace_period": "40s",
            "mem_limit": "1536m",
            "labels": label(svc["gateway"], "gateway"),
            "x-inputs": ["config/gateway.yaml"],
            **hardening,
        },
        # Grants SELECT on the reporting tables the gateway created during its boot migrations.
        "postgres-grants": {
            "image": IMAGES["postgres"],
            "entrypoint": ["bash", "/bootstrap/postgres-bootstrap.sh", "after-gateway"],
            "volumes": [f"{cfg}/postgres-bootstrap.sh:/bootstrap/postgres-bootstrap.sh:ro"],
            "secrets": use("postgres", ["superuser_password"]),
            "networks": ["core"],
            "depends_on": {"gateway": {"condition": "service_healthy"}},
            "restart": "no",
            "labels": host_label,
        },
        "pdc-agent": {
            "image": IMAGES["pdc"],
            "entrypoint": ["/bin/sh", "-c"],
            # The token goes in through the environment the agent reads, not argv.
            "command": [
                'GCLOUD_PDC_SIGNING_TOKEN="$$(cat /run/secrets/pdc_token)"; export GCLOUD_PDC_SIGNING_TOKEN; '
                'exec /usr/bin/pdc -cluster "$$PDC_CLUSTER" -gcloud-hosted-grafana-id "$$PDC_HOSTED_GRAFANA_ID"'
            ],
            "environment": {
                "PDC_CLUSTER": v["pdc_cluster"],
                "PDC_HOSTED_GRAFANA_ID": str(v["pdc_hosted_grafana_id"]),
            },
            "secrets": use("pdc", ["pdc_token"]),
            "volumes": ["pdc-home:/home/pdc"],
            "networks": ["pdc"],
            "depends_on": {"postgres": {"condition": "service_healthy"}},
            "restart": "unless-stopped",
            "labels": host_label,
            **hardening,
        },
        "alloy": {
            "image": IMAGES["alloy"],
            "hostname": svc["agent_host"],
            "command": ["run", "/etc/alloy/config.alloy", "--storage.path=/var/lib/alloy/data",
                        "--server.http.listen-addr=127.0.0.1:12345"],
            "environment": {
                "OTLP_ENDPOINT": v["grafana_otlp_endpoint"],
                "OTLP_USERNAME": str(v["grafana_otlp_username"]),
                "SERVICE_NAMESPACE": name,
                "HOST_SERVICE_NAME": svc["agent_host"],
                "COMPOSE_PROJECT": name,
            },
            "secrets": use("root", ["grafana_otlp_token"]),
            "volumes": [
                f"{cfg}/alloy.alloy:/etc/alloy/config.alloy:ro",
                "alloy-data:/var/lib/alloy/data",
                "/var/run/docker.sock:/var/run/docker.sock:ro",
                "/proc:/host/proc:ro",
                "/sys:/host/sys:ro",
                "/:/host/root:ro,rslave",
                "/var/lib/docker:/var/lib/docker:ro",
                "/dev/disk:/dev/disk:ro",
                "/run/udev/data:/run/udev/data:ro",
            ],
            "networks": ["core"],
            "pid": "host",
            "restart": "unless-stopped",
            "labels": host_label,
            "x-inputs": ["config/alloy.alloy"],
        },
        "spend-caps": {
            "image": dev_image,
            "entrypoint": ["python3", "/opt/agent-host/bin/spend_caps.py"],
            "environment": {
                "GATEWAY_URL": gateway_url,
                "SPEND_CAPS": json.dumps(spend_caps_cents(v)),
                "ADMIN_KEY_FILE": "/run/secrets/gateway_admin_write_key",
                "CA_FILE": "/etc/agent-host/ca.pem",
            },
            "secrets": use("developer-admin", ["gateway_admin_write_key"]),
            "volumes": [f"{cfg}/ca.pem:/etc/agent-host/ca.pem:ro"],
            "networks": ["core"],
            "depends_on": {"gateway": {"condition": "service_healthy"}},
            "restart": "on-failure:3",
            "labels": host_label,
            "x-inputs": ["config/ca.pem"],
            **hardening,
        },
    }

    volumes = {"claude-code": {}, "pgdata": {}, "pdc-home": {}, "alloy-data": {}}
    plugin_ref = f"grafana/agento11y#plugins/agento11y/v{agento11y_version(v)}"
    for dev in v["developers"]:
        slug = dev_slug(dev)
        ids = model_ids(v, model_keys_for_team(v, dev["team"]))
        services[f"dev-{slug}"] = {
            "image": dev_image,
            "hostname": f"dev-{slug}",
            "environment": {
                "DEVELOPER_NAME": dev["name"],
                "DEVELOPER_EMAIL": dev["email"],
                "DEVELOPER_TEAM": dev["team"],
                "GATEWAY_URL": gateway_url,
                "GATEWAY_HOSTNAME": host,
                "COGNITO_DOMAIN_URL": v["cognito_domain_url"],
                "CLAUDE_CODE_VERSION": v["claude_code_version"],
                "AGENTO11Y_CLI_VERSION": v["agento11y_cli_version"],
                "AGENTO11Y_MARKETPLACE": plugin_ref,
                "AGENTO11Y_USER_ID": dev["email"],
                "TRAFFIC_ENABLED": "true" if truthy(v["traffic_enabled"]) else "false",
                "SESSION_INTERVAL_MINUTES": str(v["session_interval_minutes"]),
                "SESSION_MODELS": model_weights(ids),
                "SERVICE_NAMESPACE": name,
                "MCP_SERVER_NAME": name,
            },
            "secrets": use(f"dev-{slug}", ["developer_password"]),
            "volumes": [
                f"claude-home-{slug}:/home/node/.claude",
                "claude-code:/opt/claude-code:ro",
                f"{cfg}/managed-settings.json:/etc/claude-code/managed-settings.json:ro",
                f"{cfg}/ca.pem:/etc/agent-host/ca.pem:ro",
                f"{cfg}/gateway-cert.pem:/etc/agent-host/gateway-cert.pem:ro",
            ],
            "networks": ["dev"],
            "shm_size": "512m",
            "mem_limit": "2g",
            "pids_limit": 1024,
            "depends_on": {"gateway": {"condition": "service_healthy"}},
            "restart": "unless-stopped",
            "labels": label(svc["agent_host"], "developer"),
            "x-inputs": ["config/managed-settings.json", "config/ca.pem", "config/gateway-cert.pem"],
            **hardening,
        }
        volumes[f"claude-home-{slug}"] = {}

    # Label each service with a hash of everything it mounts: a changed file recreates it.
    by_source = {n: s["file"][len(host_root) + 1:] for n, s in top_secrets.items()}
    for spec in services.values():
        inputs = spec.pop("x-inputs", []) + [by_source[s["source"]] for s in spec.get("secrets", [])]
        h = hashlib.sha256()
        for path in sorted(inputs):
            h.update(path.encode() + b"\0" + files[path].encode() + b"\0")
        spec["labels"] = {**spec["labels"], "agent-host.inputs": h.hexdigest()[:16]}
        for key, value in base.items():
            spec.setdefault(key, value)

    def network(bridge, **extra):
        return {"driver": "bridge", "enable_ipv6": False,
                "driver_opts": {"com.docker.network.bridge.name": bridge}, **extra}

    return {
        "name": name,
        "services": services,
        "volumes": volumes,
        "secrets": top_secrets,
        "networks": {
            "core": network(BRIDGES["core"], name=f"{name}-core", ipam={"config": [
                {"subnet": CORE_SUBNET, "ip_range": CORE_DYNAMIC_RANGE, "gateway": CORE_BRIDGE_IP}]}),
            "dev": network(BRIDGES["dev"], name=f"{name}-dev", ipam={"config": [
                {"subnet": DEV_SUBNET, "ip_range": DEV_DYNAMIC_RANGE, "gateway": DEV_BRIDGE_IP}]}),
            "pdc": network(BRIDGES["pdc"], name=f"{name}-pdc"),
        },
    }


def secret_files(v, s):
    """Map consumer -> {file name: (value, uid)} from the agent-host secret."""
    missing = [k for k in SECRET_KEYS if not s.get(k)]
    if missing:
        fail(f"agent-host secret is missing {', '.join(missing)}")

    basic = base64.b64encode(f"{v['grafana_otlp_username']}:{s['grafana_otlp_token']}".encode()).decode()
    g = UID["gateway"]
    files = {
        "gateway": {k: (s[k], g) for k in (
            "cognito_client_secret", "gateway_jwt_secret", "gateway_admin_write_key",
            "gateway_admin_read_key", "postgres_password", "agento11y_client_token",
            "tls_cert_pem", "tls_key_pem")},
        "postgres": {k: (s[k], UID["root"]) for k in ("postgres_password", "postgres_grafana_ro_password")},
        "pdc": {"pdc_token": (s["pdc_token"], UID["pdc"])},
        "root": {"grafana_otlp_token": (s["grafana_otlp_token"], UID["root"])},
        "developer-admin": {"gateway_admin_write_key": (s["gateway_admin_write_key"], UID["developer"])},
    }
    files["gateway"]["otlp_authorization"] = (f"Basic {basic}", g)
    passwords = as_obj(s["developer_passwords"])
    for dev in v["developers"]:
        pw = passwords.get(dev["name"])
        if not pw:
            fail(f"no password for developer {dev['name']}")
        files[f"dev-{dev_slug(dev)}"] = {"developer_password": (pw, UID["developer"])}
    return files


def write(path, content, mode=0o644, uid=None, check=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(content)
    if not check and uid is not None:
        os.chown(tmp, uid, uid)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--vars", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--secret-stdin", action="store_true", help="read the agent-host secret JSON on stdin")
    ap.add_argument("--secret-file", help="read the agent-host secret JSON from a file (testing)")
    ap.add_argument("--check", action="store_true", help="no chown (render as an unprivileged user)")
    ap.add_argument("--host-root", default="/etc/agent-host",
                    help="host path of --out as the Docker daemon sees it (default /etc/agent-host)")
    args = ap.parse_args()

    if args.secret_stdin:
        s = json.load(sys.stdin)
    elif args.secret_file:
        with open(args.secret_file, encoding="utf-8") as fh:
            s = json.load(fh)
    else:
        fail("pass --secret-stdin or --secret-file")
    v = load(args.vars, s)

    out = args.out
    sec_root = os.path.join(out, "secrets")
    secret_map = secret_files(v, s)

    # The Postgres superuser password is generated here once and kept: the data volume was
    # initialised with it, so it must survive re-renders.
    su_path = os.path.join(sec_root, "postgres", "superuser_password")
    if os.path.exists(su_path):
        with open(su_path, encoding="utf-8") as fh:
            su = fh.read()
    else:
        su = secrets.token_urlsafe(32)
    secret_map["postgres"]["superuser_password"] = (su, UID["root"])

    config = {
        "gateway.yaml": "# Rendered by agent-host/render/render.py. Secrets are file references.\n"
                        + dump(gateway_config(v)),
        "managed-settings.json": json.dumps({
            "forceLoginMethod": "gateway",
            "forceLoginGatewayUrl": f"https://{v['gateway_hostname']}",
            "parentSettingsBehavior": "merge",
        }, indent=2) + "\n",
        "ca.pem": s["tls_ca_pem"],
        "gateway-cert.pem": s["tls_cert_pem"],
    }
    for static in ("alloy.alloy", "postgres-bootstrap.sh"):
        with open(os.path.join(CONFIG_SRC, static), encoding="utf-8") as fh:
            config[static] = fh.read()

    files = {f"config/{k}": c for k, c in config.items()}
    files.update({f"secrets/{c}/{f}": val for c, entries in secret_map.items() for f, (val, _) in entries.items()})
    project = compose_project(v, files, args.host_root)

    os.makedirs(sec_root, exist_ok=True)
    os.chmod(sec_root, 0o700)
    for consumer, entries in secret_map.items():
        cdir = os.path.join(sec_root, consumer)
        os.makedirs(cdir, exist_ok=True)
        os.chmod(cdir, 0o700)
        for fname, (value, uid) in entries.items():
            write(os.path.join(cdir, fname), value, 0o400, uid, args.check)
        for stale in set(os.listdir(cdir)) - set(entries):
            os.remove(os.path.join(cdir, stale))
    # A removed developer's password (or any retired secret) does not linger on disk.
    for stale in set(os.listdir(sec_root)) - set(secret_map):
        shutil.rmtree(os.path.join(sec_root, stale))

    for fname, content in config.items():
        write(os.path.join(out, "config", fname), content)
    write(os.path.join(out, "compose.yaml"),
          "# Rendered by agent-host/render/render.py; edits are overwritten on the next render.\n"
          + dump(project), 0o644)
    print(f"render: wrote compose project for {len(v['developers'])} developers to {out}")


if __name__ == "__main__":
    main()
