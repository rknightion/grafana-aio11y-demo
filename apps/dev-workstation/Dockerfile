# One simulated developer: Claude Code (installed at container start, never baked in), the
# Agent Observability CLI and Claude Code plugin, the stdio MCP servers the demo prompts use, the
# sign-in bot (tmux + headless Chromium) and the unattended traffic loop.
#
# Build context is the REPOSITORY ROOT (it needs apps/mcp-tools, apps/gateway/claude-install.sh
# and agent-host/prompts): docker build -f apps/dev-workstation/Dockerfile .
# Base images are pinned by tag and multi-arch index digest; bump both together.
# Dockerfile.dockerignore next to this file limits what the context sends.

FROM ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc AS uv

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS release-key
ARG RELEASE_SIGNER_URL=https://downloads.claude.ai/keys/claude-code.asc
ARG RELEASE_SIGNER_FPR=31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    curl -fsSL "$RELEASE_SIGNER_URL" -o /tmp/key.asc; \
    fpr="$(gpg --show-keys --with-colons /tmp/key.asc | awk -F: '$1 == "fpr" { print $10; exit }')"; \
    [ "$fpr" = "$RELEASE_SIGNER_FPR" ] || { echo "release key fingerprint $fpr != $RELEASE_SIGNER_FPR" >&2; exit 1; }; \
    gpg --dearmor < /tmp/key.asc > /claude-code-release.gpg

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

# Keep AGENTO11Y_VERSION in step with AGENTO11Y_IMAGE_VERSION in agent-host/render/render.py (the
# plugin marketplace is pinned to the same release tag). The checksums are that release's
# published linux archive SHA-256s; the installer is pinned to the tag's commit and checksum.
ARG AGENTO11Y_VERSION=0.48.0
ARG AGENTO11Y_SHA256_AMD64=4f9214b215b908d3d6f3b0c267e5bb2c9396d578d8e882cd82c5c80a834d1163
ARG AGENTO11Y_SHA256_ARM64=5eff95f194406e5d9ebe365334b51ed1bc8d9117fe1e8a4c420af5b39d52e4b9
ARG AGENTO11Y_INSTALLER_COMMIT=a9b03af481659cfbb6787946512834cd544df9c6
ARG AGENTO11Y_INSTALLER_SHA256=88419401c678f229c995cf1459b9c734a11517749e92fd7e9bcc4658e1300862
ARG PLAYWRIGHT_VERSION=1.63.0
ARG MCP_PY_VERSION=2026.8.18
ARG MCP_NODE_VERSION=2026.8.31

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git gpgv jq less openssl procps python3 python3-yaml tini tmux \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /usr/local/bin/
COPY --from=release-key /claude-code-release.gpg /usr/share/keyrings/claude-code-release.gpg

ENV UV_TOOL_DIR=/opt/uv-tools \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_PREFERENCE=only-system \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

# stdio MCP servers, installed now so no session waits on a package download.
RUN uv tool install "mcp-server-time==${MCP_PY_VERSION}" \
    && uv tool install "mcp-server-fetch==${MCP_PY_VERSION}" \
    && uv tool install "mcp-server-git==${MCP_PY_VERSION}" \
    && npm install -g --no-fund --no-audit --ignore-scripts \
       "@modelcontextprotocol/server-sequential-thinking@${MCP_NODE_VERSION}" \
       "@modelcontextprotocol/server-memory@${MCP_NODE_VERSION}" \
    && npm cache clean --force

# Headless Chromium for the sign-in bot (gateway /device page and the Cognito hosted UI).
RUN uv venv /opt/login-venv \
    && uv pip install --python /opt/login-venv/bin/python "playwright==${PLAYWRIGHT_VERSION}" \
    && /opt/login-venv/bin/playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /opt/ms-playwright

# Grafana Agent Observability CLI (the Claude Code plugin's hooks run `agento11y claude-code hook`),
# from the release archive checked against the pinned SHA-256. The official installer is kept,
# pinned and checksummed, only for a runtime agento11y_cli_version override (dev-entrypoint).
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) arch=amd64; sum="$AGENTO11Y_SHA256_AMD64" ;; \
      arm64) arch=arm64; sum="$AGENTO11Y_SHA256_ARM64" ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac; \
    archive="agento11y_${AGENTO11Y_VERSION}_linux_${arch}.tar.gz"; \
    curl -fsSL "https://github.com/grafana/agento11y/releases/download/plugins/agento11y/v${AGENTO11Y_VERSION}/${archive}" -o "/tmp/${archive}"; \
    echo "${sum}  /tmp/${archive}" | sha256sum -c -; \
    tar -xzf "/tmp/${archive}" -C /usr/local/bin agento11y; \
    rm -f "/tmp/${archive}"; \
    chmod 0755 /usr/local/bin/agento11y; \
    ln -sf agento11y /usr/local/bin/sigil; \
    agento11y --version; \
    curl -fsSL "https://raw.githubusercontent.com/grafana/agento11y/${AGENTO11Y_INSTALLER_COMMIT}/plugins/agento11y/scripts/install.sh" \
      -o /usr/local/lib/agento11y-install.sh; \
    echo "${AGENTO11Y_INSTALLER_SHA256}  /usr/local/lib/agento11y-install.sh" | sha256sum -c -

# The demo's own MCP server (odds, news, head-to-head history, offers), shared with the agents.
COPY apps/mcp-tools/package.json apps/mcp-tools/package-lock.json /opt/mcp-tools/
RUN npm ci --prefix /opt/mcp-tools --omit=dev --no-fund --no-audit --ignore-scripts && npm cache clean --force
COPY apps/mcp-tools/src /opt/mcp-tools/src
RUN test -f /opt/mcp-tools/src/server.mjs

# npm/npx/corepack are unused from here on: the demo prompts deliberately run sample repos with
# plain `node`, never `npm install` or `npm test` (see agent-host/prompts). Drop the base image's
# bundled npm CLI so its own vulnerable transitive deps (pacote, sigstore, picomatch, ...) never
# ship in the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY apps/gateway/claude-install.sh /usr/local/bin/claude-install
COPY agent-host/prompts /opt/agent-host/prompts
COPY apps/dev-workstation/bin/ /opt/agent-host/bin/
COPY apps/dev-workstation/entrypoint.sh /usr/local/bin/dev-entrypoint

RUN chmod 0755 /usr/local/bin/claude-install /usr/local/bin/dev-entrypoint /opt/agent-host/bin/* \
    && ln -s /opt/agent-host/bin/dev-login /usr/local/bin/dev-login \
    && ln -s /opt/agent-host/bin/dev-session /usr/local/bin/dev-session \
    && ln -s /opt/agent-host/bin/dev-loop /usr/local/bin/dev-loop \
    && ln -s /opt/agent-host/bin/dev-reseed /usr/local/bin/dev-reseed \
    && ln -s /opt/agent-host/bin/dev-login-link /usr/local/bin/dev-login-link \
    && install -d -o node -g node /home/node/.claude /home/node/work /home/node/.local/bin

ENV HOME=/home/node \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    CLAUDE_CODE_CACHE=/opt/claude-code \
    NODE_EXTRA_CA_CERTS=/etc/agent-host/ca.pem \
    PATH=/home/node/.local/bin:/usr/local/bin:/usr/bin:/bin \
    DISABLE_AUTOUPDATER=1 \
    PROMPTS_DIR=/opt/agent-host/prompts

USER 1000:1000
WORKDIR /home/node/work
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/dev-entrypoint"]
