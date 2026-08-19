FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/observability/package.json ./packages/observability/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @rms/contracts build
RUN pnpm --filter @rms/config build
RUN pnpm --filter @rms/observability build
RUN pnpm --filter @rms/database generate
RUN pnpm --filter @rms/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 rms
RUN addsystem --system --uid 1001 rms

COPY --from=builder --chown=rms:rms /app/apps/api/dist ./dist
COPY --from=builder --chown=rms:rms /app/apps/api/package.json ./
COPY --from=builder --chown=rms:rms /app/node_modules ./node_modules
COPY --from=builder --chown=rms:rms /app/packages/database/prisma ./prisma

USER rms

EXPOSE 3001

CMD ["node", "dist/main"]
