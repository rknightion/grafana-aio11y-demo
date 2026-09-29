# One simulated developer: Claude Code (installed at container start, never baked in), the
# Agent Observability CLI and Claude Code plugin, the stdio MCP servers the demo prompts use, the
# sign-in bot (tmux + headless Chromium) and the unattended traffic loop.
#
# Build context is the REPOSITORY ROOT (it needs apps/mcp-tools, apps/gateway/claude-install.sh,
# agent-host/prompts and agent-host/codebase): docker build -f apps/dev-workstation/Dockerfile .
# Base images are pinned by tag and multi-arch index digest; bump both together.
# Dockerfile.dockerignore next to this file limits what the context sends.

FROM ghcr.io/astral-sh/uv:0.12.20@sha256:100047e74f30778ab704942321a09750d6158739573ff58bf3924085cc6cd2d8 AS uv

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

# Grafana Agent Observability CLI (the Claude Code plugin's hooks run `agento11y claude-code hook`),
# built from its Go module at the release tag. `go install ...@vX.Y.Z` checks the module against
# the Go checksum database (sum.golang.org), so the pin is the version alone: Renovate bumps it
# (go datasource) together with AGENTO11Y_IMAGE_VERSION in agent-host/render/render.py, with no
# per-architecture archive checksums to keep in step. Cross-compiled on the build platform; the
# flags match the release's .goreleaser.yaml.
FROM --platform=$BUILDPLATFORM golang:1.27.1-bookworm@sha256:69a7b9788769bec032d238959b61854e9ae87f57be9029ec04e9885fabf99195 AS agento11y
ARG AGENTO11Y_VERSION=0.48.0
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOWORK=off GOTOOLCHAIN=auto GOFLAGS=-trimpath
# go install puts a cross-compiled binary under bin/<os>_<arch>/ and a native one under bin/.
RUN GOOS="$TARGETOS" GOARCH="$TARGETARCH" go install \
      -ldflags "-s -w -X main.version=v${AGENTO11Y_VERSION}" \
      "github.com/grafana/agento11y/plugins/agento11y/cmd/agento11y@v${AGENTO11Y_VERSION}" \
    && bin="$(go env GOPATH)/bin" \
    && mkdir -p /out \
    && if [ -f "$bin/${TARGETOS}_${TARGETARCH}/agento11y" ]; then cp "$bin/${TARGETOS}_${TARGETARCH}/agento11y" /out/; else cp "$bin/agento11y" /out/; fi

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# The installer is used only for a runtime agento11y_cli_version override (dev-entrypoint). It takes
# the version to install as an argument and verifies that release's archive itself, so its pin is
# independent of AGENTO11Y_VERSION and never needs moving with it.
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

# Agent Observability CLI from the agento11y build stage above.
COPY --from=agento11y /out/agento11y /usr/local/bin/agento11y
RUN set -eu; \
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

# npm/npx/corepack are unused from here on: the demo prompts work inside the seeded Touchline
# checkout (see agent-host/codebase) with plain `node`, never `npm install` or `npm test`. Drop
# the base image's bundled npm CLI so its own vulnerable transitive deps (pacote, sigstore,
# picomatch, ...) never ship in the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY apps/gateway/claude-install.sh /usr/local/bin/claude-install
COPY agent-host/prompts /opt/agent-host/prompts
COPY agent-host/codebase /opt/agent-host/codebase
COPY apps/dev-workstation/bin/ /opt/agent-host/bin/
COPY apps/dev-workstation/entrypoint.sh /usr/local/bin/dev-entrypoint

RUN chmod 0755 /usr/local/bin/claude-install /usr/local/bin/dev-entrypoint /opt/agent-host/bin/* \
    /opt/agent-host/codebase/seed-repo \
    && ln -s /opt/agent-host/bin/dev-login /usr/local/bin/dev-login \
    && ln -s /opt/agent-host/bin/dev-session /usr/local/bin/dev-session \
    && ln -s /opt/agent-host/bin/dev-loop /usr/local/bin/dev-loop \
    && ln -s /opt/agent-host/bin/dev-reseed /usr/local/bin/dev-reseed \
    && ln -s /opt/agent-host/bin/dev-login-link /usr/local/bin/dev-login-link \
    && ln -s /opt/agent-host/bin/pii-burst-window /usr/local/bin/pii-burst-window \
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
