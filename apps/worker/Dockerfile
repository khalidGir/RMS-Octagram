# Node 22 LTS (v22.23.3). Digest-pinned for reproducible, reviewable bumps.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base
RUN apk add --no-cache libc6-compat openssl
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/observability/package.json ./packages/observability/
COPY packages/config/package.json ./packages/config/
RUN HUSKY=0 pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY . .
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/observability/node_modules ./packages/observability/node_modules
RUN pnpm --filter @rms/contracts build
RUN pnpm --filter @rms/config build
RUN pnpm --filter @rms/observability build
RUN pnpm --filter @rms/database generate
RUN pnpm --filter @rms/database build
RUN pnpm --filter @rms/worker build

FROM base AS runner
WORKDIR /app/apps/worker
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 rms
RUN adduser --system --uid 1001 --ingroup rms --no-create-home rms

COPY --from=builder --chown=rms:rms /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/
COPY --from=builder --chown=rms:rms /app/node_modules /app/node_modules
COPY --from=builder --chown=rms:rms /app/packages /app/packages
COPY --from=builder --chown=rms:rms /app/apps/worker/package.json ./package.json
COPY --from=builder --chown=rms:rms /app/apps/worker/node_modules ./node_modules
COPY --from=builder --chown=rms:rms /app/apps/worker/dist ./dist

# Fail the build if Prisma or the native sharp module cannot load inside this image.
RUN node -e "require('@prisma/client'); require('sharp'); console.log('worker runtime deps ok')"

USER rms

CMD ["node", "dist/main"]
