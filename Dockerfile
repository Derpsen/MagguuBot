FROM node:26-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json vite.config.ts tailwind.config.ts postcss.config.js ./
COPY src ./src
COPY frontend ./frontend
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini fontconfig font-noto font-noto-emoji
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-frontend ./dist-frontend
COPY --from=builder /app/package.json ./package.json
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.HTTP_PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
