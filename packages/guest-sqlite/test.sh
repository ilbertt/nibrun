#!/usr/bin/env bash
set -euo pipefail

reader_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
image_prefix=nibrun-guest-sqlite
test_platform=${GUEST_SQLITE_TEST_PLATFORM:-linux/amd64}

# shellcheck disable=SC1091
set -a && . "$reader_dir/versions.env" && set +a

build() {
  docker build \
    --platform="$test_platform" \
    --build-arg BUILDER_IMAGE="$BUILDER_IMAGE" \
    --build-arg SQLITE_ARCHIVE="$SQLITE_ARCHIVE" \
    --build-arg SQLITE_SHA256="$SQLITE_SHA256" \
    --build-arg JANSSON_VERSION="$JANSSON_VERSION" \
    --build-arg JANSSON_SHA256="$JANSSON_SHA256" \
    --progress=plain \
    "$@" \
    "$reader_dir"
}

echo '=== unit tests ==='
# Never cached: a test whose result was reused is a test that did not run, and these
# assert on real elapsed time.
build --target=unit-test --no-cache-filter=unit-test --output type=cacheonly

echo '=== official Hrana client tests ==='
build --target=hrana-test-server --tag "$image_prefix-hrana-test"
bun test "$reader_dir/tests/hrana-client.test.ts"

