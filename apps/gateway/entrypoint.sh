#!/usr/bin/env bash
# Start the Claude apps gateway: resolve the pinned Claude Code release (downloaded and verified
# at container start, never baked into the image), then exec `claude gateway`.
#
# Environment:
#   CLAUDE_CODE_VERSION   required, e.g. 2.1.281
#   CLAUDE_CODE_CACHE     shared release cache (default /opt/claude-code)
#   GATEWAY_CONFIG        config path (default /etc/claude/gateway.yaml)
# Any arguments replace the default `gateway --config ...` command, e.g. `--version`.
set -Eeuo pipefail

: "${CLAUDE_CODE_VERSION:?set CLAUDE_CODE_VERSION to the pinned Claude Code release}"
config="${GATEWAY_CONFIG:-/etc/claude/gateway.yaml}"

claude="$(claude-install "$CLAUDE_CODE_VERSION" "${CLAUDE_CODE_CACHE:-/opt/claude-code}")"

if [[ $# -gt 0 ]]; then
  exec "$claude" "$@"
fi
[[ -r "$config" ]] || { echo "gateway-entrypoint: $config not readable" >&2; exit 1; }
exec "$claude" gateway --config "$config"
