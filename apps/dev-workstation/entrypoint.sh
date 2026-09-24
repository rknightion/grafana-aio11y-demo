#!/usr/bin/env bash
# Developer container start: install the pinned Claude Code, reset the per-developer config on
# its volume (onboarding flags, user-scope MCP servers, settings), then hand over to the traffic
# loop, which signs the developer in through the gateway and runs sessions.
set -Eeuo pipefail

log() { printf '%s dev-entrypoint[%s]: %s\n' "$(date -u +%FT%TZ)" "${DEVELOPER_NAME:-?}" "$*" >&2; }

: "${CLAUDE_CODE_VERSION:?}" "${DEVELOPER_NAME:?}" "${GATEWAY_URL:?}"

# 1. Claude Code: verified release from the shared read-only cache, or a private download.
claude_bin="$(claude-install "$CLAUDE_CODE_VERSION" "${CLAUDE_CODE_CACHE:-/opt/claude-code}")"
ln -sf "$claude_bin" "$HOME/.local/bin/claude"
log "claude $(claude --version 2>/dev/null | head -1)"

# 2. Agent Observability CLI: the image ships a pinned build; a specific agento11y_cli_version
#    that differs is installed into ~/.local/bin (the installer verifies the archive checksum).
want="${AGENTO11Y_CLI_VERSION:-latest}"
have="$(agento11y --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [[ "$want" != "latest" && -n "$want" && "$want" != "$have" ]]; then
  log "installing agento11y $want (image has ${have:-none})"
  VERSION="$want" INSTALL_DIR="$HOME/.local/bin" sh /usr/local/lib/agento11y-install.sh >&2 \
    || log "agento11y $want install failed; keeping ${have:-none}"
fi
log "agento11y $(agento11y --version 2>/dev/null | head -1)"

# 3. Per-developer Claude config (on the claude-home volume, so sign-in survives restarts), reset
#    to the known state on every start: see dev-reseed.
dev-reseed

if [[ $# -gt 0 ]]; then
  exec "$@"
fi
exec dev-loop
