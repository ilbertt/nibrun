#!/bin/bash
# Runs ON the control-plane instance, invoked by the deploy workflow via SSM.
# Non-secret config arrives as environment variables exported by the SSM
# command; secrets are read from SSM here, by the instance role, so they never
# pass through CI.
set -euo pipefail

cd "$(dirname "$0")"

log() { echo "=== [on_control_plane_deploy $(date -u +%H:%M:%S)] $* ==="; }

: "${API_IMAGE_URI:?}" "${GATEWAY_IMAGE_URI:?}" "${PG_BACKUP_IMAGE_URI:?}" \
  "${SSM_SECRET_PREFIX:?}" "${API_HOSTNAME:?}" "${APPS_DOMAIN:?}" "${ACME_EMAIL:?}" \
  "${AWS_DEFAULT_REGION:?}" "${DATA_VOLUME_ID:?}" "${DEPLOY_BUCKET:?}" "${ARTIFACTS_BUCKET:?}"

log "Ensuring the persistent data volume is mounted and holds the data-bearing volumes"
MOUNT_POINT=/data \
SUBDIRS="volumes/postgres-data volumes/gateway-data" \
DATA_VOLUME_ID="$DATA_VOLUME_ID" \
  bash ensure_data_volume.sh

secret() {
  aws ssm get-parameter --name "${SSM_SECRET_PREFIX}/$1" --with-decryption \
    --query Parameter.Value --output text
}

DB_PASSWORD="$(secret db_password)"
BETTER_AUTH_SECRET="$(secret better_auth_secret)"
HOST_TOKEN="$(secret host_token)"

umask 077
cat > .env <<EOF
POSTGRES_USER=nibrun
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=nibrun
DATABASE_URL=postgres://nibrun:${DB_PASSWORD}@postgres:5432/nibrun

PORT=3000
BASE_URL=https://${API_HOSTNAME}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}

# Shared with every compute host: the agent presents it when it dials the
# socket. Rotating it means redeploying the control plane first, then the hosts.
NIBRUN_HOST_TOKEN=${HOST_TOKEN}

# Real S3, so no S3_ENDPOINT override and no static keys — the api picks up the
# instance role over IMDS (the instance allows two hops so containers reach it).
S3_BUCKET=${ARTIFACTS_BUCKET}
AWS_REGION=${AWS_DEFAULT_REGION}
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}

# Reached over the compose network only; the gateway's admin port is never
# published to the host.
GATEWAY_ADMIN_URL=http://gateway:2019

API_HOSTNAME=${API_HOSTNAME}
APPS_DOMAIN=${APPS_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}

API_IMAGE_URI=${API_IMAGE_URI}
GATEWAY_IMAGE_URI=${GATEWAY_IMAGE_URI}
PG_BACKUP_IMAGE_URI=${PG_BACKUP_IMAGE_URI}
BACKUP_BUCKET=${DEPLOY_BUCKET}

LOG_LEVEL=info
EOF

compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

log "Pulling images"
$compose pull

log "Starting services (up -d --remove-orphans)"
$compose up -d --remove-orphans

log "Pruning dangling images"
docker image prune -f

# Gate the deploy on container health: every long-running service must report a
# `healthy` healthcheck, and one-shot services (migrations) must have exited 0.
# Poll until that holds or we time out, then fail so CI/SSM surfaces a bad deploy
# instead of reporting success while a container is unhealthy or crash-looping.
# Parsed with pure shell (the box has no jq).
log "Waiting for all containers to become healthy"
deadline=$((SECONDS + 360))
while :; do
  unhealthy=""
  while IFS='|' read -r name state health exitcode; do
    [ -z "$name" ] && continue
    if [ -n "$health" ]; then
      [ "$health" = "healthy" ] || unhealthy="${unhealthy}${name}: health=${health}\n"
    elif [ "$state" = "exited" ]; then
      [ "${exitcode:-0}" = "0" ] || unhealthy="${unhealthy}${name}: exited(${exitcode})\n"
    elif [ "$state" != "running" ]; then
      unhealthy="${unhealthy}${name}: state=${state}\n"
    fi
  done <<EOF
$($compose ps -a --format '{{.Name}}|{{.State}}|{{.Health}}|{{.ExitCode}}')
EOF
  [ -z "$unhealthy" ] && { log "All containers healthy"; break; }
  if [ "$SECONDS" -ge "$deadline" ]; then
    log "Containers not healthy after timeout:"
    printf '%b' "$unhealthy"
    $compose ps -a --format 'table {{.Name}}\t{{.Status}}'
    exit 1
  fi
  sleep 5
done

log "Compose service status"
$compose ps -a --format 'table {{.Name}}\t{{.Status}}'

log "Image versions"
$compose images

log "Deploy finished"
