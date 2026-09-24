set shell := ["bash", "-euo", "pipefail", "-c"]

# image name => "<build context> <Dockerfile>"
images := "agents:apps:apps/agents/Dockerfile site:apps:apps/site/Dockerfile site-browser:apps:apps/site/Dockerfile.browser mcp-tools:apps:apps/mcp-tools/Dockerfile gateway:apps/gateway:apps/gateway/Dockerfile dev-workstation:.:apps/dev-workstation/Dockerfile"

# List recipes
default:
    @just --list

# Install hooks, Node dependencies and Terraform providers
setup:
    pre-commit install --hook-type pre-commit --hook-type commit-msg
    for app in agents site mcp-tools; do (cd apps/$app && npm ci); done
    tofu -chdir=terraform init -backend=false -input=false
    helm dependency build charts/touchline

# Format Terraform, JSON and Node sources
[group('check')]
fmt:
    tofu fmt -recursive terraform examples
    for app in agents site mcp-tools; do (cd apps/$app && npx --no-install prettier --write . 2>/dev/null || true); done

# Fail if anything is unformatted
[group('check')]
fmt-check:
    tofu fmt -recursive -check terraform examples

# Lint Terraform, the Helm chart, rendered manifests and shell
[group('check')]
lint:
    tofu -chdir=terraform validate
    tflint --chdir=terraform
    helm lint charts/touchline -f charts/touchline/ci/test-values.yaml
    helm template touchline charts/touchline -f charts/touchline/ci/test-values.yaml | kubeconform -strict -summary -
    git ls-files -co --exclude-standard -z '*.sh' | xargs -0 -r shellcheck
    python3 tools/scrub_check.py

# Run the Node test suites
[group('check')]
test:
    for app in agents site mcp-tools; do (cd apps/$app && npm test); done

# The pre-commit gate: formatting, lint and tests
[group('check')]
check: fmt-check lint test

# check plus image builds (needs a Docker daemon)
[group('check')]
ci: check
    # Docker daemon: build every image for the host architecture, no push
    for spec in {{ images }}; do IFS=: read -r name ctx file <<<"$spec"; docker build -t local/$name -f "$file" "$ctx"; done

# Build multi-arch images and push them to REGISTRY (e.g. a private ECR mirror)
[group('build')]
images-push registry tag="dev":
    # Multi-platform builds need a docker-container builder; create a dedicated one if missing.
    docker buildx inspect aio11y-multiarch >/dev/null 2>&1 || docker buildx create --name aio11y-multiarch --driver docker-container >/dev/null
    for spec in {{ images }}; do IFS=: read -r name ctx file <<<"$spec"; docker buildx build --builder aio11y-multiarch --platform linux/amd64,linux/arm64 -t {{ registry }}/$name:{{ tag }} -f "$file" --push "$ctx"; done

# Render the chart to plain manifests for kubectl users (VALUES from `terraform output -raw chart_values`)
[group('gen')]
render values="charts/touchline/ci/test-values.yaml":
    mkdir -p deploy/kubectl/rendered
    helm template touchline charts/touchline -f {{ values }} > deploy/kubectl/rendered/touchline.yaml

# Print each developer's gateway sign-in link from the agent host (manual login fallback)
[group('infra')]
login-developers dir="examples/complete":
    #!/usr/bin/env bash
    set -euo pipefail
    id=$(tofu -chdir={{ dir }} output -raw agent_host_instance_id)
    aws ssm start-session --target "$id" --document-name AWS-StartInteractiveCommand --parameters command="sudo agent-host-login-links"

# Open the gateway admin UI through an SSM port-forward on localhost:8443
[group('infra')]
gateway-tunnel dir="examples/complete":
    #!/usr/bin/env bash
    set -euo pipefail
    id=$(tofu -chdir={{ dir }} output -raw agent_host_instance_id)
    aws ssm start-session --target "$id" --document-name AWS-StartPortForwardingSession --parameters portNumber=8443,localPortNumber=8443

# Forward the gateway to localhost:443 and open a throwaway Chrome/Chromium that trusts only the gateway's certificate
[group('infra')]
login-tunnel dir="examples/complete":
    #!/usr/bin/env bash
    set -euo pipefail
    id=$(tofu -chdir={{ dir }} output -raw agent_host_instance_id)
    host=$(tofu -chdir={{ dir }} output -raw gateway_url); host=${host#https://}; host=${host%%/*}
    # SPKI pin of the gateway's leaf certificate: base64(SHA-256(SubjectPublicKeyInfo)).
    pin=$(tofu -chdir={{ dir }} output -raw gateway_cert_pem | openssl x509 -noout -pubkey \
      | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)
    profile=$(mktemp -d "${TMPDIR:-/tmp}/gateway-login.XXXXXX")
    # The browser trusts this one key and resolves the gateway name to the tunnel, for this
    # profile only: nothing is added to /etc/hosts or to any system or browser trust store.
    flags=(--user-data-dir="$profile" --ignore-certificate-errors-spki-list="$pin"
      --host-resolver-rules="MAP $host 127.0.0.1" --no-first-run --no-default-browser-check)
    browser=""
    for b in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
             "/Applications/Chromium.app/Contents/MacOS/Chromium" \
             "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
             "$HOME/Applications/Chromium.app/Contents/MacOS/Chromium"; do
      if [[ -x "$b" ]]; then browser=$b; break; fi
    done
    if [[ -z "$browser" ]]; then
      for b in google-chrome google-chrome-stable chromium chromium-browser; do
        if command -v "$b" >/dev/null; then browser=$(command -v "$b"); break; fi
      done
    fi
    echo "gateway ${host}, leaf certificate SPKI pin sha256/${pin}"
    bpid=""
    if [[ -n "$browser" ]]; then
      "$browser" "${flags[@]}" about:blank >/dev/null 2>&1 &
      bpid=$!
      echo "Opened a throwaway browser profile in ${profile}; paste each developer's sign-in link there."
    else
      echo "No Chrome or Chromium found. Start one yourself with:"
      printf '  <chrome>'; printf ' %q' "${flags[@]}"; echo
    fi
    cleanup() {
      if [[ -n "$bpid" ]]; then kill "$bpid" 2>/dev/null || true; fi
      rm -rf -- "$profile"
    }
    trap cleanup EXIT
    echo "Forwarding localhost:443 to the gateway; Ctrl-C closes the tunnel, the browser and its profile."
    aws ssm start-session --target "$id" --document-name AWS-StartPortForwardingSession --parameters portNumber=8443,localPortNumber=443
