# syntax=docker/dockerfile:1
# Touchline Times site API: serves the reader page and the Faro browser bundle, and proxies
# /api/picks to the orchestrator. No browser binaries here; see Dockerfile.browser.
#   docker buildx build --platform linux/amd64,linux/arm64 -f apps/site/Dockerfile apps
FROM node:22-alpine AS build
WORKDIR /app
COPY site/package.json site/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY site/public ./public
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY site/package.json site/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/playwright node_modules/playwright-core node_modules/@grafana/faro-* \
 && find node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete \
 && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY site/package.json ./
COPY --from=build /app/public/index.html /app/public/app.bundle.js ./public/
COPY site/src ./src
USER node
EXPOSE 8080
CMD ["node", "--import", "./src/telemetry.mjs", "src/server.mjs"]
