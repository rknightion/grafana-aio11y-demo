# syntax=docker/dockerfile:1
# Touchline Times agents image: the five agents, the load generator and the experiment runner.
# AGENT_ROLE picks the process (orchestrator | news | odds | editorial | compliance | loadgen);
# the experiment CronJob runs `node experiments/run-experiment.mjs --scheduled --execute`.
#
# Build context is the apps/ directory, because the agents import the shared tool module from
# apps/mcp-tools (a local file: dependency, kept as a relative symlink in node_modules):
#   docker buildx build --platform linux/amd64,linux/arm64 -f apps/agents/Dockerfile apps
# Pure JavaScript dependencies only, so the same steps build natively on either architecture.
FROM node:22-alpine AS deps
WORKDIR /app
COPY mcp-tools/package.json mcp-tools/
COPY mcp-tools/src mcp-tools/src
COPY agents/package.json agents/package-lock.json agents/.npmrc agents/
RUN cd agents \
 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && find node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete \
 && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app/agents
COPY --from=deps /app/mcp-tools /app/mcp-tools
COPY --from=deps /app/agents/node_modules ./node_modules
COPY agents/package.json ./
COPY agents/src ./src
COPY agents/experiments ./experiments
COPY agents/config ./config
# Default loadgen spend-ledger dir, writable by the runtime user (mount a volume here to keep it
# across pod restarts; with a read-only root filesystem an emptyDir or PVC is required).
RUN mkdir -p /var/lib/loadgen && chown node:node /var/lib/loadgen
USER node
EXPOSE 8080
CMD ["node", "--experimental-loader=@opentelemetry/instrumentation/hook.mjs", "--import", "./src/instrumentation.mjs", "src/server.mjs"]
