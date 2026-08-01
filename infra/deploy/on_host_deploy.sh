#!/bin/bash
# Runs ON a compute host, invoked by the deploy workflow via SSM. One command
# fans out to every host, so nothing here may be host-specific — the data volume
# is discovered rather than named, and the host token is the same for the fleet.
set -euo pipefail

cd "$(dirname "$0")"

log() { echo "=== [on_host_deploy $(hostname) $(date -u +%H:%M:%S)] $* ==="; }

: "${SSM_SECRET_PREFIX:?}" "${API_HOSTNAME:?}" "${AWS_DEFAULT_REGION:?}"

VOLUMES_DIR="${VOLUMES_DIR:-/var/lib/nibrun/volumes}"

log "Ensuring the persistent data volume is mounted at $(dirname "$VOLUMES_DIR")"
MOUNT_POINT="$(dirname "$VOLUMES_DIR")" \
SUBDIRS="$(basename "$VOLUMES_DIR")" \
  bash ensure_data_volume.sh

secret() {
  aws ssm get-parameter --name "${SSM_SECRET_PREFIX}/$1" --with-decryption \
    --query Parameter.Value --output text
}

HOST_TOKEN="$(secret host_token)"

# Install to a temporary name and rename over the old binary: rename is atomic,
# so a restart can never catch a half-written file. Replacing in place would
# also fail with ETXTBSY while the current agent is running.
log "Installing the agent binary"
install -m 0755 dist/nibrun-agent /usr/local/bin/nibrun-agent.new
mv -f /usr/local/bin/nibrun-agent.new /usr/local/bin/nibrun-agent

log "Writing /etc/nibrun/agent.env"
mkdir -p /etc/nibrun
umask 077
# Read after the unit's own Environment= lines, so these win.
cat > /etc/nibrun/agent.env <<EOF
NIBRUN_API_URL=wss://${API_HOSTNAME}/agent
NIBRUN_HOST_TOKEN=${HOST_TOKEN}
NIBRUN_VOLUMES_DIR=${VOLUMES_DIR}
AWS_REGION=${AWS_DEFAULT_REGION}
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}
EOF
chmod 0600 /etc/nibrun/agent.env

log "Installing the systemd unit"
install -m 0644 nibrun-agent.service /etc/systemd/system/nibrun-agent.service
systemctl daemon-reload
systemctl enable nibrun-agent

# Guests are separate processes and keep running across this; the agent
# reattaches to them and re-dials the control plane.
log "Restarting the agent"
systemctl restart nibrun-agent

# Restart=always means a crash-looping agent still reports `active` in the gaps,
# so require it to hold active for a few consecutive seconds rather than
# sampling once.
log "Waiting for the agent to settle"
stable=0
for _ in $(seq 1 30); do
  if [ "$(systemctl is-active nibrun-agent || true)" = "active" ]; then
    stable=$((stable + 1))
  else
    stable=0
  fi
  [ "$stable" -ge 5 ] && break
  sleep 1
done

if [ "$stable" -lt 5 ]; then
  log "Agent did not stay up"
  systemctl status nibrun-agent --no-pager || true
  journalctl -u nibrun-agent -n 50 --no-pager || true
  exit 1
fi

systemctl status nibrun-agent --no-pager | head -5
log "Deploy finished"
