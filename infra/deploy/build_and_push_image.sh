#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_REPOSITORY:?}" "${IMAGE_TAG:?}" "${BUILD_CONTEXT:?}" "${DOCKERFILE:?}"

# The box is x86_64; a build on an arm runner would push an image it cannot run.
PLATFORM="${PLATFORM:-linux/amd64}"
SOURCE_LABEL="${SOURCE_LABEL:-https://github.com/ilbertt/nibrun}"
CACHE_FROM="${CACHE_FROM:-}"
CACHE_TO="${CACHE_TO:-}"

image_uri="${IMAGE_REPOSITORY}:${IMAGE_TAG}"

cmd=(
  docker buildx build
  --platform "$PLATFORM"
  --push
  --tag "$image_uri"
  --label "org.opencontainers.image.source=$SOURCE_LABEL"
  --file "$DOCKERFILE"
)

if [ -n "$CACHE_FROM" ]; then
  cmd+=(--cache-from "$CACHE_FROM")
fi
if [ -n "$CACHE_TO" ]; then
  cmd+=(--cache-to "$CACHE_TO")
fi

cmd+=("$BUILD_CONTEXT")

printf '$'
printf ' %q' "${cmd[@]}"
printf '\n'
"${cmd[@]}"
