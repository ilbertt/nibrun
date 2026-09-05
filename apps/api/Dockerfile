# syntax=docker/dockerfile:1-labs

# Build context must be the monorepo root. Build from the monorepo root with:
#   docker build -f apps/api/Dockerfile -t nibrun-api .

FROM oven/bun:1.4.2-slim AS base
WORKDIR /monorepo

FROM base AS install
WORKDIR /temp/deps
COPY package.json bun.lock ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /temp/deps ./
COPY tsconfig.json turbo.json ./
COPY packages packages
COPY apps apps
COPY brand brand
ENV NODE_ENV=production
RUN bun run build --filter=@repo/api

FROM gcr.io/distroless/base-debian12:debug AS release
WORKDIR /app
COPY --from=build /monorepo/apps/api/dist/nibrun-api ./
ENV NODE_ENV=production
EXPOSE 3000/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/busybox/wget", "-q", "--spider", "http://localhost:3000/api/health"]
ENTRYPOINT ["/app/nibrun-api"]
