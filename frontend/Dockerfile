# syntax=docker/dockerfile:1.6
#
# Multi-stage build for the Next.js frontend.
# Uses the standalone output mode for a slim runtime image.

############################
# 1. deps
############################
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

############################
# 2. build
############################
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined here. Pass via build args / compose env.
ARG NEXT_PUBLIC_BACKEND_URL=
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL

RUN npm run build

############################
# 3. runtime
############################
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app

# Next.js standalone output bundles only the files needed at runtime.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app

EXPOSE 3000

CMD ["node", "server.js"]
