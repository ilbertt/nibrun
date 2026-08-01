#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_REPOSITORY:?}" "${IMAGE_TAG:?}" "${BUILD_CONTEXT:?}" "${DOCKERFILE:?}"

PLATFORM="${PLATFORM:-linux/amd64}"
SOURCE_LABEL="${SOURCE_LABEL:-https://github.com/ilbertt/nibrun}"
CACHE_SCOPE="${CACHE_SCOPE:-}"
CACHE_FROM="${CACHE_FROM:-}"
CACHE_TO="${CACHE_TO:-}"
EXTRA_IMAGE_TAGS="${EXTRA_IMAGE_TAGS:-}"

image_uri="${IMAGE_REPOSITORY}:${IMAGE_TAG}"

cmd=(
  docker buildx build
  --platform "$PLATFORM"
  --push
  --tag "$image_uri"
  --label "org.opencontainers.image.source=$SOURCE_LABEL"
  --file "$DOCKERFILE"
)

for extra_tag in $EXTRA_IMAGE_TAGS; do
  cmd+=(--tag "${IMAGE_REPOSITORY}:${extra_tag}")
done

if [ -n "$CACHE_SCOPE" ]; then
  cmd+=(--label "nibrun.cache-scope=$CACHE_SCOPE")
fi
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
