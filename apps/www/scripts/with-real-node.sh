#!/bin/sh
# Runs a command with Bun's `node` stand-in taken off PATH.
#
# The root's turbo scripts use `bun run --bun`, which symlinks `node` to Bun inside a temp
# directory it prepends to PATH for every descendant process. miniflare — which the Cloudflare
# plugin boots to prerender this app — crashes on teardown under Bun's `node:http`, reporting
# "Server is not running" after the pages have already rendered. Dropping that one PATH entry
# is enough; nothing else here cares which runtime `node` is.
PATH="$(printf %s "$PATH" | tr ':' '\n' | grep -v '/bun-node-' | paste -sd: -)"
export PATH

exec "$@"
