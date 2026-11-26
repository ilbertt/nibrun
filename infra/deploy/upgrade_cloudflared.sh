#!/bin/bash
set -euo pipefail

primary=$(docker compose ps -a -q cloudflared)
replica=$(docker compose --profile tunnel-upgrade ps -a -q cloudflared-upgrade)

start_connector() {
  docker compose up -d --no-deps --pull never --wait --wait-timeout 120 "$1"
}

if [[ -n "$primary" ]]; then
  image=$(docker compose config --images cloudflared)
  desired_image=$(docker image inspect --format '{{.Id}}' "$image")
  desired_config=$(docker compose config --hash cloudflared)
  current=$(docker inspect --format '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' "$primary")

  if [[ "$current" != "$desired_image ${desired_config#cloudflared }" ]]; then
    # A previous deploy may have left the replica as the only working connector.
    replica_health=absent
    if [[ -n "$replica" ]]; then
      replica_health=$(docker inspect --format '{{.State.Health.Status}}' "$replica")
    fi
    if [[ "$replica_health" != healthy ]]; then
      start_connector cloudflared-upgrade
    fi
  elif [[ -z "$replica" ]]; then
    exit 0
  fi
elif [[ -z "$replica" ]]; then
  # On first boot the normal compose up starts the connector with the rest of the stack.
  exit 0
fi

start_connector cloudflared
docker compose rm --stop --force cloudflared-upgrade
