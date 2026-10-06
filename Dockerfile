# syntax=docker/dockerfile:1.7
# ─── Build Stage ─────────────────────────────────
# node:24-alpine multi-arch index digest (2026-10-06)
ARG NODE_VERSION=24
ARG NODE_DIGEST=sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
FROM node:${NODE_VERSION}-alpine@${NODE_DIGEST} AS builder

WORKDIR /app

# Build tools required by native modules (better-sqlite3, @napi-rs/canvas).
RUN apk add --no-cache python3 make g++

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    CI=1

# BuildKit cache mount keeps the npm cache across builds without bloating layers.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js ./
COPY src ./src
COPY frontend ./frontend
RUN npm run build && npm prune --omit=dev

# ─── Runtime Stage ───────────────────────────────
FROM node:${NODE_VERSION}-alpine@${NODE_DIGEST} AS runtime

ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

WORKDIR /app

# apk upgrade + explicit libexpat/libpng: Trivy HIGH CVE-2026-93990 (libexpat 2.8.5-r0), CVE-2026-46675 (libpng 1.6.59-r0)
RUN apk upgrade --no-cache \
    && apk add --no-cache --upgrade tini fontconfig font-noto font-noto-emoji libssl3 libcrypto3 libexpat libpng \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
              /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
             /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production

LABEL org.opencontainers.image.title="MagguuBot" \
      org.opencontainers.image.description="Discord bot + admin dashboard for Magguu media homelab" \
      org.opencontainers.image.source="https://github.com/Derpsen/MagguuBot" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-frontend ./dist-frontend
COPY --from=builder /app/package.json ./package.json
RUN mkdir -p /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.HTTP_PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
