#!/bin/bash
# Runs ON an app host, invoked by the deploy workflow via SSM. Non-secret config
# arrives as environment variables exported by the SSM command; secrets are read
# from SSM here, by the instance role, so they never pass through CI.
#
# The bundle this lives in is kilobytes: units, the ZeroFS config, this script.
# The binaries are not in it. They are fetched by version into a versioned path
# and skipped entirely if that version is already on disk, which is what makes a
# repeat deploy nearly free and rollback a symlink swap.
set -euo pipefail

cd "$(dirname "$0")"

log() { echo "=== [on_box_deploy $(date -u +%H:%M:%S)] $* ==="; }

: "${AWS_REGION:?}" "${SSM_SECRET_PREFIX:?}" "${DATA_VOLUME_ID:?}" \
  "${AGENT_VERSION:?}" "${AGENT_URL:?}" \
  "${ZEROFS_VERSION:?}" "${ZEROFS_URL:?}" "${ZEROFS_SHA256:?}" "${ZEROFS_MEMBER:?}" \
  "${FIRECRACKER_VERSION:?}" "${FIRECRACKER_URL:?}" "${FIRECRACKER_SHA256:?}" \
  "${FIRECRACKER_DIRECTORY:?}" \
  "${CADDY_VERSION:?}" "${CADDY_URL:?}" "${CADDY_SHA256:?}" \
  "${FILESYSTEMS_BUCKET:?}" "${API_HOSTNAME:?}" "${APP_DOMAIN:?}" \
  "${GUEST_IMAGES_BUCKET:?}" "${ARTIFACTS_BUCKET:?}"

# Empty until a guest image is adopted in infra/app-host/versions.json. A host
# with none deploys fine; it simply has no image to boot microVMs from, which is
# the correct state before any tenant app exists.
GUEST_IMAGE_VERSION="${GUEST_IMAGE_VERSION:-}"

# Composed here rather than in CI because the prefix is scoped to this host and
# the instance id is only known on it. ZeroFS opens exactly one prefix read-write
# fleet-wide, and this is what makes that true by construction.
instance_id=$(
  token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  curl -fsS -H "X-aws-ec2-metadata-token: $token" \
    http://169.254.169.254/latest/meta-data/instance-id
)
NIBRUN_FILESYSTEMS_URL="s3://${FILESYSTEMS_BUCKET}/hosts/${instance_id}"

NIBRUN_DIR=/opt/nibrun
VERSIONS_DIR="$NIBRUN_DIR/versions"
CURRENT_DIR="$NIBRUN_DIR/bin"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# /etc/caddy/rendered is the agent's to write and Caddy's to read, so it is
# created here — the agent only replaces the file inside it.
mkdir -p "$VERSIONS_DIR" "$CURRENT_DIR" "$NIBRUN_DIR/bundle" /var/lib/nibrun \
  /etc/nibrun /etc/zerofs /etc/caddy/tls /etc/caddy/rendered

secret() {
  aws ssm get-parameter --name "${SSM_SECRET_PREFIX}/$1" --with-decryption \
    --query Parameter.Value --output text
}

log "Ensuring the data volume is mounted"
bash ensure_data_volume.sh zerofs

id -u zerofs >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin zerofs
chown -R zerofs:zerofs /data/zerofs

# The public edge runs unprivileged; systemd grants it CAP_NET_BIND_SERVICE and
# nothing else. Only the private key is its own, which is why tls/ is the one
# directory here nobody else can traverse.
id -u caddy >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin caddy
chown caddy:caddy /etc/caddy/tls
chmod 0700 /etc/caddy/tls

# --- Fetching versions -------------------------------------------------------
#
# A version directory is only considered present once its marker exists, so an
# interrupted download is retried rather than adopted as if it had finished.

is_installed() { [ -f "$VERSIONS_DIR/$1/$2/.installed" ]; }

mark_installed() { touch "$VERSIONS_DIR/$1/$2/.installed"; }

verify_sha256() {
  echo "$2  $1" | sha256sum -c - >/dev/null
}

install_zerofs() {
  local dir="$VERSIONS_DIR/zerofs/$ZEROFS_VERSION"
  mkdir -p "$dir"
  curl -fsSL "$ZEROFS_URL" -o "$WORK_DIR/zerofs.tar.gz"
  verify_sha256 "$WORK_DIR/zerofs.tar.gz" "$ZEROFS_SHA256"
  # One multiplatform tarball, flat, holding a binary per platform.
  tar xzf "$WORK_DIR/zerofs.tar.gz" -C "$WORK_DIR" "$ZEROFS_MEMBER"
  install -m 0755 "$WORK_DIR/$ZEROFS_MEMBER" "$dir/zerofs"
  mark_installed zerofs "$ZEROFS_VERSION"
}

install_firecracker() {
  local dir="$VERSIONS_DIR/firecracker/$FIRECRACKER_VERSION"
  mkdir -p "$dir"
  curl -fsSL "$FIRECRACKER_URL" -o "$WORK_DIR/firecracker.tgz"
  verify_sha256 "$WORK_DIR/firecracker.tgz" "$FIRECRACKER_SHA256"
  tar xzf "$WORK_DIR/firecracker.tgz" -C "$WORK_DIR"
  # Both binaries ship in the one tarball, suffixed with the version and arch.
  # The jailer is version-locked to its firecracker, so they move together.
  install -m 0755 "$WORK_DIR/$FIRECRACKER_DIRECTORY/firecracker-${FIRECRACKER_VERSION}-x86_64" \
    "$dir/firecracker"
  install -m 0755 "$WORK_DIR/$FIRECRACKER_DIRECTORY/jailer-${FIRECRACKER_VERSION}-x86_64" \
    "$dir/jailer"
  mark_installed firecracker "$FIRECRACKER_VERSION"
}

install_caddy() {
  local dir="$VERSIONS_DIR/caddy/$CADDY_VERSION"
  mkdir -p "$dir"
  curl -fsSL "$CADDY_URL" -o "$WORK_DIR/caddy.tar.gz"
  verify_sha256 "$WORK_DIR/caddy.tar.gz" "$CADDY_SHA256"
  tar xzf "$WORK_DIR/caddy.tar.gz" -C "$WORK_DIR" caddy
  install -m 0755 "$WORK_DIR/caddy" "$dir/caddy"
  mark_installed caddy "$CADDY_VERSION"
}

install_agent() {
  local dir="$VERSIONS_DIR/agent/$AGENT_VERSION"
  mkdir -p "$dir"
  aws s3 cp "$AGENT_URL" "$dir/nibrun-agent"
  chmod 0755 "$dir/nibrun-agent"
  mark_installed agent "$AGENT_VERSION"
}

install_guest_image() {
  local dir="$VERSIONS_DIR/guest-image/$GUEST_IMAGE_VERSION"
  mkdir -p "$dir"
  aws s3 cp --recursive "s3://${GUEST_IMAGES_BUCKET}/${GUEST_IMAGE_VERSION}/" "$dir/"
  # Written by the publish step from the manifest's own digests, because this box
  # has no jq to read the manifest with.
  ( cd "$dir" && sha256sum -c SHA256SUMS )
  mark_installed guest-image "$GUEST_IMAGE_VERSION"
}

# Succeeds when the active symlink changed, fails when it was already correct.
# That distinction is the whole point: it decides what restarts.
activate() {
  local component=$1 version=$2
  local target="$VERSIONS_DIR/$component/$version"
  local link="$CURRENT_DIR/$component"

  if [ "$(readlink "$link" 2>/dev/null || true)" = "$target" ]; then
    return 1
  fi
  ln -sfn "$target" "$link"
  return 0
}

NEEDS_RESTART=()
# Caddy is the one component whose configuration is swapped without stopping it,
# because a change meant for one app must not interrupt traffic to the others on
# the host. Its *binary* still cannot move under a running process, so a version
# bump lands in NEEDS_RESTART like everything else.
NEEDS_RELOAD=()

ensure() {
  local component=$1 version=$2 installer=$3

  if is_installed "$component" "$version"; then
    log "$component $version already on disk"
  else
    log "Fetching $component $version"
    "$installer"
  fi

  if activate "$component" "$version"; then
    log "$component now $version"
    NEEDS_RESTART+=("$component")
  fi
}

ensure zerofs "$ZEROFS_VERSION" install_zerofs
ensure firecracker "$FIRECRACKER_VERSION" install_firecracker
ensure caddy "$CADDY_VERSION" install_caddy
ensure agent "$AGENT_VERSION" install_agent

if [ -n "$GUEST_IMAGE_VERSION" ]; then
  ensure guest-image "$GUEST_IMAGE_VERSION" install_guest_image
else
  log "No guest image adopted — see infra/app-host/versions.json"
fi

# --- Configuration -----------------------------------------------------------
#
# Rewritten every deploy and compared before restarting, so a changed secret or a
# changed template reaches the process that reads it without a version having to
# move.

umask 077

changed_file() {
  local path=$1
  if [ -f "$path" ] && cmp -s "$path" "$path.new"; then
    rm -f "$path.new"
    return 1
  fi
  mv "$path.new" "$path"
  return 0
}

cat > /etc/zerofs/zerofs.env.new <<EOF
NIBRUN_FILESYSTEMS_URL=${NIBRUN_FILESYSTEMS_URL}
NIBRUN_FILESYSTEMS_PASSWORD=$(secret filesystems_encryption_password)
AWS_REGION=${AWS_REGION}
EOF
chmod 0600 /etc/zerofs/zerofs.env.new
changed_file /etc/zerofs/zerofs.env && NEEDS_RESTART+=(zerofs) || true

# What the agent reports this host as running, validated against the protocol's
# HostVersions — four version strings, and nothing like the pin file CI resolved
# them from. A host with no adopted guest image is a legitimate state, but the
# schema has no way to say so, so it says `none` rather than omitting the field.
cat > "$NIBRUN_DIR/bundle/versions.json.new" <<EOF
{
  "agent": "${AGENT_VERSION}",
  "guestImage": "${GUEST_IMAGE_VERSION:-none}",
  "zerofs": "${ZEROFS_VERSION}",
  "firecracker": "${FIRECRACKER_VERSION}"
}
EOF
chmod 0644 "$NIBRUN_DIR/bundle/versions.json.new"
changed_file "$NIBRUN_DIR/bundle/versions.json" && NEEDS_RESTART+=(agent) || true

cp zerofs/config.toml /etc/zerofs/config.toml.new
# Read by ZeroFS itself, which runs as its own user, so it cannot inherit the
# 0600 the umask above gives the secrets around it. It holds no secret: every
# value that is one arrives through zerofs.env.
chmod 0644 /etc/zerofs/config.toml.new
changed_file /etc/zerofs/config.toml && NEEDS_RESTART+=(zerofs) || true

secret agent_bootstrap_token > /var/lib/nibrun/bootstrap-token.new
chmod 0600 /var/lib/nibrun/bootstrap-token.new
changed_file /var/lib/nibrun/bootstrap-token && NEEDS_RESTART+=(agent) || true

cat > /etc/nibrun/agent.env.new <<EOF
AGENT_CONTROL_PLANE_URL=https://${API_HOSTNAME}
AGENT_BOOTSTRAP_TOKEN_FILE=/var/lib/nibrun/bootstrap-token
AGENT_ARTIFACT_BUCKET=${ARTIFACTS_BUCKET}
AGENT_AWS_REGION=${AWS_REGION}
# The same prefix ZeroFS is pointed at, from the one variable both are rendered
# from: a volume naming a prefix this host does not serve is refused, so the two
# drifting apart would fail every volume placed here.
AGENT_ZEROFS_STORAGE_PREFIX=${NIBRUN_FILESYSTEMS_URL}
AWS_REGION=${AWS_REGION}
EOF
chmod 0600 /etc/nibrun/agent.env.new
changed_file /etc/nibrun/agent.env && NEEDS_RESTART+=(agent) || true

# The origin certificate Caddy serves. Held base64-encoded in SSM because a PEM
# is multi-line and `--output text` mangles that, with no jq here to read the
# JSON form instead; Terraform does the encoding (ssm.tf).
write_pem() {
  secret "$1" | base64 -d > "$2"
}

log "Writing the origin TLS material"
write_pem app_host_caddy_tls_cert /etc/caddy/tls/origin.crt.new
write_pem app_host_caddy_tls_key /etc/caddy/tls/origin.key.new
changed_file /etc/caddy/tls/origin.crt && NEEDS_RELOAD+=(caddy) || true
changed_file /etc/caddy/tls/origin.key && NEEDS_RELOAD+=(caddy) || true
chown caddy:caddy /etc/caddy/tls/origin.crt /etc/caddy/tls/origin.key

cp caddy/Caddyfile /etc/caddy/Caddyfile.new
changed_file /etc/caddy/Caddyfile && NEEDS_RELOAD+=(caddy) || true

cp cloudflare-origin-pull-ca.pem /etc/caddy/cloudflare-origin-pull-ca.pem.new
changed_file /etc/caddy/cloudflare-origin-pull-ca.pem && NEEDS_RELOAD+=(caddy) || true

# `caddy reload` re-adapts the Caddyfile, and the substitutions in it are read
# from the unit's environment — so this is a restart rather than a reload: only
# a fresh ExecStart is guaranteed to re-read the file.
cat > /etc/caddy/caddy.env.new <<EOF
APP_DOMAIN=${APP_DOMAIN}
EOF
changed_file /etc/caddy/caddy.env && NEEDS_RESTART+=(caddy) || true

# Modes are set rather than inherited: none of this is secret, all of it is read
# by a user that is not the one writing it, and the umask this script runs under
# is whatever RunCommand hands it.
chmod 0644 /etc/caddy/Caddyfile /etc/caddy/cloudflare-origin-pull-ca.pem /etc/caddy/caddy.env
chmod 0755 /etc/caddy /etc/caddy/rendered

log "Installing systemd units"
units_changed=0
for unit in systemd/*.service; do
  cp "$unit" "/etc/systemd/system/$(basename "$unit").new"
  changed_file "/etc/systemd/system/$(basename "$unit")" && units_changed=1 || true
done
if [ "$units_changed" = "1" ]; then
  systemctl daemon-reload
fi

systemctl enable nibrun-zerofs.service nibrun-zerofs-mount.service \
  nibrun-caddy.service nibrun-agent.service >/dev/null

# --- Restarting --------------------------------------------------------------
#
# Only what actually moved. In particular no tenant microVM is restarted by an
# agent bump: they are systemd units in their own right rather than children of
# the agent, so it comes back and reconciles against what it finds.

needs_restart() { printf '%s\n' "${NEEDS_RESTART[@]+"${NEEDS_RESTART[@]}"}" | grep -qx "$1"; }

needs_reload() { printf '%s\n' "${NEEDS_RELOAD[@]+"${NEEDS_RELOAD[@]}"}" | grep -qx "$1"; }

if needs_restart zerofs; then
  # Disruptive: ZeroFS serves the NBD device behind every guest disk on this
  # host, so this stalls I/O for every app on it and an attached guest can
  # remount read-only rather than wait. It happens because someone deliberately
  # edited the ZeroFS pin, never as a side effect of a feature push.
  log "ZeroFS changed — restarting it, which interrupts every app on this host"
  systemctl restart nibrun-zerofs.service
else
  systemctl start nibrun-zerofs.service
fi

# Where the agent creates a tenant's disk. Bound to ZeroFS above, so a restart of
# the server takes it with it and this brings both back in order.
systemctl restart nibrun-zerofs-mount.service

# A restart drops every connection this host is serving, so it happens only when
# the binary or the unit's environment moved. Everything else — a new Caddyfile,
# a re-issued certificate — is swapped in place, and a config that fails to load
# fails the deploy while the running one keeps serving.
if needs_restart caddy || ! systemctl is-active --quiet nibrun-caddy.service; then
  log "Starting the user-app proxy"
  systemctl restart nibrun-caddy.service
elif needs_reload caddy; then
  log "Proxy configuration changed — reloading it, leaving connections up"
  systemctl reload nibrun-caddy.service
fi

if needs_restart agent; then
  log "Agent changed — restarting it, leaving tenant microVMs running"
  systemctl restart nibrun-agent.service
else
  systemctl start nibrun-agent.service
fi

# Firecracker and the guest image are read by the *next* boot of a microVM, so a
# bump reaches an app when it is next redeployed and restarts nothing now.

log "Waiting for the services to settle"
for unit in nibrun-zerofs nibrun-caddy nibrun-agent; do
  for _ in $(seq 1 30); do
    state=$(systemctl is-active "$unit.service" || true)
    [ "$state" = "active" ] && break
    sleep 2
  done
  if [ "$(systemctl is-active "$unit.service" || true)" != "active" ]; then
    log "$unit did not become active"
    systemctl status "$unit.service" --no-pager --lines 50 || true
    journalctl -u "$unit.service" --no-pager --lines 100 || true
    exit 1
  fi
done

log "Active versions"
for component in zerofs firecracker caddy agent guest-image; do
  if [ -L "$CURRENT_DIR/$component" ]; then
    echo "  $component -> $(basename "$(readlink "$CURRENT_DIR/$component")")"
  fi
done

log "Deploy finished"
