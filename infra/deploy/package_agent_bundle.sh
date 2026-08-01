#!/usr/bin/env bash
# Builds the tarball every compute host downloads. The agent is not a container
# — it is what creates isolation, so it needs the host's cgroups, /dev/kvm and
# network — which is why this ships a compiled binary and a systemd unit rather
# than an image reference.
set -euo pipefail

output_path="${1:-${BUNDLE_PATH:-}}"
if [ -z "$output_path" ]; then
  echo "Usage: $0 <output-tarball>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$(dirname "$output_path")"

binary="$repo_root/apps/agent/dist/nibrun-agent"
if [ ! -f "$binary" ]; then
  echo "Missing $binary — run 'bun run --bun turbo build --filter=@repo/agent' first." >&2
  exit 1
fi

# The hosts are linux/amd64; a binary compiled on a developer's macOS will
# install fine and then fail to exec, which is a confusing way to find out.
if ! file "$binary" | grep -q "ELF 64-bit"; then
  echo "Warning: $binary is not a Linux ELF binary. Build it with --target=bun-linux-x64." >&2
fi

cmd=(
  tar czf "$output_path"
  -C "$repo_root/apps/agent"
  dist/nibrun-agent nibrun-agent.service
  -C "$repo_root/infra/deploy"
  on_host_deploy.sh ensure_data_volume.sh
)

printf '$'
printf ' %q' "${cmd[@]}"
printf '\n'
"${cmd[@]}"
