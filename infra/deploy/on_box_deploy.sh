#!/bin/bash
# Runs ON the EC2 instance, invoked by the deploy workflow via SSM. Non-secret
# config arrives as environment variables exported by the SSM command; secrets
# are read from SSM here, by the instance role, so they never pass through CI.
set -euo pipefail

cd "$(dirname "$0")"

log() { echo "=== [on_box_deploy $(date -u +%H:%M:%S)] $* ==="; }

: "${API_IMAGE_URI:?}" "${API_HOSTNAME:?}" "${API_GITHUB_CLIENT_ID:?}" \
  "${ARTIFACTS_BUCKET:?}" "${API_S3_ENDPOINT:?}" "${PG_BACKUP_IMAGE_URI:?}" \
  "${PG_BACKUP_BUCKET:?}" "${SSM_SECRET_PREFIX:?}" "${AWS_REGION:?}" \
  "${DATA_VOLUME_ID:?}" "${DOZZLE_HOSTNAME:?}" "${INTERNAL_PORT:?}"

# Per-deployment values no infrastructure resource feeds, still overridable from
# the deploy so they never have to be edited here. The host port bindings are
# loopback-only in docker-compose.yml; they are not the public surface. The
# MinIO ports are set because compose substitutes the whole file even though
# production does not run that service.
API_PORT="${API_PORT:-3000}"
API_DB_USER="${API_DB_USER:-nibrun}"
API_DB_NAME="${API_DB_NAME:-nibrun}"
API_DB_PORT="${API_DB_PORT:-5432}"
API_S3_PORT="${API_S3_PORT:-9000}"
API_S3_CONSOLE_PORT="${API_S3_CONSOLE_PORT:-9001}"
DOZZLE_PORT="${DOZZLE_PORT:-8080}"

# Docker does not create missing host directories for local volumes with
# `o: bind` driver_opts (unlike container bind mounts) — volume creation fails.
# Only Postgres: production talks to real S3, so MinIO does not run here and has
# no volume to back.
log "Ensuring the persistent data volume is mounted and holds the data-bearing volumes"
bash ensure_data_volume.sh volumes/postgres-data

secret() {
  aws ssm get-parameter --name "${SSM_SECRET_PREFIX}/$1" --with-decryption \
    --query Parameter.Value --output text
}

API_DB_PASSWORD="$(secret api_db_password)"
API_BETTER_AUTH_SECRET="$(secret api_better_auth_secret)"
API_GITHUB_CLIENT_SECRET="$(secret api_github_client_secret)"
API_S3_ACCESS_KEY_ID="$(secret api_s3_access_key_id)"
API_S3_SECRET_ACCESS_KEY="$(secret api_s3_secret_access_key)"
# The same parameter every app host reads, so the api can recognise the
# credential a host presents rather than trusting whatever arrives.
AGENT_BOOTSTRAP_TOKEN="$(secret agent_bootstrap_token)"

# Everything written from here on carries a secret: the PEMs below, then .env.
umask 077

# The origin certificate Caddy serves. Held base64-encoded in SSM because a PEM
# is multi-line and `--output text` mangles that, with no jq here to read the
# JSON form instead; Terraform does the encoding (ssm.tf).
write_pem() {
  secret "$1" | base64 -d > "$2"
}

# Inside caddy/ because that whole directory is what gets mounted, and outside
# the bundle's own files, which the next deploy overwrites.
log "Writing the origin TLS material"
mkdir -p caddy/tls
write_pem caddy_tls_cert caddy/tls/origin.crt
write_pem caddy_tls_key caddy/tls/origin.key

# Every key here is a compose substitution variable; docker-compose.yml maps each
# onto the name the image expects. Values fixed by the compose topology
# (container ports, internal service URLs) deliberately do not appear.
cat > .env <<EOF
AWS_REGION=${AWS_REGION}

API_IMAGE_URI=${API_IMAGE_URI}
API_HOSTNAME=${API_HOSTNAME}
API_PORT=${API_PORT}
API_BASE_URL=https://${API_HOSTNAME}
API_BETTER_AUTH_SECRET=${API_BETTER_AUTH_SECRET}
API_GITHUB_CLIENT_ID=${API_GITHUB_CLIENT_ID}
API_GITHUB_CLIENT_SECRET=${API_GITHUB_CLIENT_SECRET}
AGENT_BOOTSTRAP_TOKEN=${AGENT_BOOTSTRAP_TOKEN}

API_DB_USER=${API_DB_USER}
API_DB_PASSWORD=${API_DB_PASSWORD}
API_DB_NAME=${API_DB_NAME}
API_DB_PORT=${API_DB_PORT}

API_S3_ENDPOINT=${API_S3_ENDPOINT}
ARTIFACTS_BUCKET=${ARTIFACTS_BUCKET}
API_S3_ACCESS_KEY_ID=${API_S3_ACCESS_KEY_ID}
API_S3_SECRET_ACCESS_KEY=${API_S3_SECRET_ACCESS_KEY}
API_S3_PORT=${API_S3_PORT}
API_S3_CONSOLE_PORT=${API_S3_CONSOLE_PORT}

PG_BACKUP_IMAGE_URI=${PG_BACKUP_IMAGE_URI}
PG_BACKUP_BUCKET=${PG_BACKUP_BUCKET}

DOZZLE_HOSTNAME=${DOZZLE_HOSTNAME}
DOZZLE_PORT=${DOZZLE_PORT}

INTERNAL_PORT=${INTERNAL_PORT}
EOF

compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# `compose up` reports a taken port as a docker-proxy bind failure minutes in,
# costing a CI round trip to learn what the box knew before it started. The edge
# binds every interface, so any listener on the port collides whatever address it
# holds — including a loopback-only one, which is how Dozzle's 8080 broke this.
# The edge is the expected holder on a redeploy, since nothing recreates it.
log "Checking port ${INTERNAL_PORT} is free"
port_holder=$(ss -lntpH "sport = :${INTERNAL_PORT}")
if [ -n "$port_holder" ] &&
  [ "$(docker ps --filter "publish=${INTERNAL_PORT}" --format '{{.Names}}')" != caddy ]; then
  log "INTERNAL_PORT ${INTERNAL_PORT} is already held:"
  printf '%s\n' "$port_holder"
  exit 1
fi

log "Pulling images"
$compose pull

# Dozzle reads a user list holding a bcrypt hash, never the password itself, so
# something has to do the hashing. Doing it here rather than in Terraform keeps
# the salt out of state and makes rotation a matter of changing the parameter:
# the file is rebuilt from it on every deploy. `generate` writes the file to
# stdout and compose's own chatter to stderr, so the redirect stays clean, and
# running it through compose takes the image version from docker-compose.yml
# rather than repeating it here.
log "Writing the Dozzle user list"
mkdir -p dozzle/data
$compose run --rm --no-deps -T --entrypoint /dozzle dozzle generate \
  --name Admin --email "admin@${API_HOSTNAME}" \
  --password "$(secret dozzle_password)" admin > dozzle/data/users.yml.new
mv dozzle/data/users.yml.new dozzle/data/users.yml

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

# `up -d` leaves a container alone when only a bind-mounted file changed, so a
# new Caddyfile or a re-issued certificate would go on being ignored. Reload
# picks both up with no dropped connections, where recreating the edge would
# drop them, and a config that does not load fails the deploy without disturbing
# the one already running.
#
# --force because a rotated certificate does not change the Caddyfile, and
# without it Caddy compares the two configs, finds them identical and skips the
# reload — leaving the old certificate served until something restarts it.
log "Reloading Caddy"
$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --force

log "Compose service status"
$compose ps -a --format 'table {{.Name}}\t{{.Status}}'

log "Image versions"
$compose images

log "Deploy finished"
