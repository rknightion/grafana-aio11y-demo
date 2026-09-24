#!/usr/bin/env bash
# Install a pinned Claude Code release for this machine's architecture, verified end to end:
# the release manifest's detached GPG signature is checked against Anthropic's release key
# (fingerprint pinned at image build), then the binary's SHA-256 is checked against the manifest.
#
# Usage: claude-install <version> [cache-root]
# Prints the path of the verified binary on stdout. Everything else goes to stderr.
#
# The cache root (default /opt/claude-code, falling back to $HOME/.cache/claude-code when it is
# not writable) holds <version>/<platform>/{claude,manifest.json,manifest.json.sig}. A cached
# binary is re-verified on every call, so a read-only shared cache is still checked at each start.
set -Eeuo pipefail

RELEASES="${CLAUDE_RELEASES_URL:-https://downloads.claude.ai/claude-code-releases}"
KEYRING="${CLAUDE_RELEASE_KEYRING:-/usr/share/keyrings/claude-code-release.gpg}"

log() { printf 'claude-install: %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

version="${1:-}"
root="${2:-/opt/claude-code}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z, got '$version'"
[[ -r "$KEYRING" ]] || die "release keyring $KEYRING missing"

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac
platform="linux-$arch"
if compgen -G '/lib/ld-musl-*' >/dev/null; then platform="$platform-musl"; fi

# Verify the manifest signature and the binary checksum in directory $1. Returns non-zero on any
# mismatch so the caller can re-download.
verify_dir() {
  local dir=$1 want got
  [[ -s "$dir/claude" && -s "$dir/manifest.json" && -s "$dir/manifest.json.sig" ]] || return 1
  gpgv --keyring "$KEYRING" "$dir/manifest.json.sig" "$dir/manifest.json" >/dev/null 2>&1 || {
    log "manifest signature check failed in $dir"
    return 1
  }
  [[ "$(jq -r .version "$dir/manifest.json")" == "$version" ]] || {
    log "manifest in $dir is not for $version"
    return 1
  }
  want="$(jq -r --arg p "$platform" '.platforms[$p].checksum // empty' "$dir/manifest.json")"
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { log "manifest has no checksum for $platform"; return 1; }
  got="$(sha256sum "$dir/claude" | cut -d' ' -f1)"
  [[ "$got" == "$want" ]] || { log "checksum mismatch for $dir/claude"; return 1; }
}

if ! mkdir -p "$root" 2>/dev/null || [[ ! -w "$root" ]]; then
  if [[ -x "$root/$version/$platform/claude" ]] && verify_dir "$root/$version/$platform"; then
    printf '%s\n' "$root/$version/$platform/claude"
    exit 0
  fi
  log "$root is read-only and holds no verified $version; using a private cache"
  root="${HOME:-/tmp}/.cache/claude-code"
  mkdir -p "$root"
fi
dir="$root/$version/$platform"

# One installer at a time per cache (several containers may share it).
exec 8>"$root/.lock"
flock 8

if verify_dir "$dir"; then
  log "verified cached Claude Code $version ($platform)"
  printf '%s\n' "$dir/claude"
  exit 0
fi

tmp="$(mktemp -d "$root/.dl.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
fetch() {
  curl --fail --silent --show-error --location --retry 5 --retry-delay 3 --retry-all-errors \
    --connect-timeout 20 "$1" -o "$2"
}
log "downloading Claude Code $version for $platform"
fetch "$RELEASES/$version/manifest.json" "$tmp/manifest.json"
fetch "$RELEASES/$version/manifest.json.sig" "$tmp/manifest.json.sig"
binary="$(jq -r --arg p "$platform" '.platforms[$p].binary // "claude"' "$tmp/manifest.json")"
fetch "$RELEASES/$version/$platform/$binary" "$tmp/claude"
chmod 0755 "$tmp/claude"
verify_dir "$tmp" || die "downloaded release failed verification"

rm -rf -- "$dir"
mkdir -p "$(dirname "$dir")"
mv "$tmp" "$dir"
chmod 0755 "$dir"
trap - EXIT
log "installed and verified Claude Code $version ($platform)"
printf '%s\n' "$dir/claude"
