# syntax=docker/dockerfile:1
# Touchline Times MCP tools: a stdio MCP server (run with `docker run -i`), or a source of the
# server for other images: COPY --from=<this image> /app /opt/touchline-mcp-tools
#   docker buildx build --platform linux/amd64,linux/arm64 -f apps/mcp-tools/Dockerfile apps
FROM node:22-alpine AS deps
WORKDIR /app
COPY mcp-tools/package.json mcp-tools/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && find node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete \
 && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY mcp-tools/package.json ./
COPY mcp-tools/src ./src
# npm/npx/corepack are unused at runtime (the entrypoint is plain node); drop the base image's
# bundled npm CLI so its own vulnerable transitive deps (pacote, sigstore, picomatch, ...) never
# ship in the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER node
ENTRYPOINT ["node", "src/server.mjs"]
