# syntax=docker/dockerfile:1-labs

# Build context must be the monorepo root. Build from the monorepo root with:
#   docker build -f apps/api/Dockerfile -t nibrun-api .

FROM oven/bun:1.3.14-slim AS base
WORKDIR /monorepo

# Deliberately on the pinned bun, not the canary the build needs: canary rejects
# a lockfile it has just written itself when a dependency carries a large set of
# optional peers (oven-sh/bun#20913). Installing first keeps --frozen-lockfile
# meaningful; the resolutions come from the lockfile either way.
FROM base AS install
WORKDIR /temp/deps
COPY package.json bun.lock ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN bun install --frozen-lockfile

FROM base AS build
# TODO: remove this step once bun v1.4 is out and update .bun-version
# `bun upgrade` shells out to unzip, which the slim image does not ship.
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/* \
  && bun upgrade --canary
COPY --from=install /temp/deps ./
COPY tsconfig.json turbo.json ./
COPY packages packages
COPY apps apps
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
