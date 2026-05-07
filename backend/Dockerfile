# syntax=docker/dockerfile:1.6
#
# Multi-stage build for the backend. The runtime image drops build deps and dev
# dependencies but keeps the compiled JS and the native better-sqlite3 binary.

############################
# 1. deps + build
############################
FROM node:20-alpine AS builder

# better-sqlite3 needs a C++ toolchain to build its native binding.
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Prune dev deps from the install we already have so we can copy node_modules
# into the runtime image without re-installing.
RUN npm prune --omit=dev

############################
# 2. runtime
############################
FROM node:20-alpine AS runtime

# Runtime libs for the native sqlite binding.
RUN apk add --no-cache libstdc++ sqlite

# Run as non-root.
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --chown=app:app scripts ./scripts

# Persistent volume for SQLite. Override DATA_DIR to relocate.
RUN mkdir -p /app/data && chown -R app:app /app/data
VOLUME ["/app/data"]

USER app

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
