#!/usr/bin/env bash
# Runs in CI. Rolls the api + gateway + Postgres stack onto the control-plane
# box: downloads the bundle it already uploaded to S3, unpacks it, and hands
# over to on_control_plane_deploy.sh.
set -euo pipefail

: "${BUNDLE_URL:?}" "${DEPLOY_GROUP:?}" "${SSM_SECRET_PREFIX:?}" "${AWS_REGION:?}"
: "${API_IMAGE_URI:?}" "${GATEWAY_IMAGE_URI:?}" "${PG_BACKUP_IMAGE_URI:?}"
: "${API_HOSTNAME:?}" "${APPS_DOMAIN:?}" "${ACME_EMAIL:?}"
: "${DATA_VOLUME_ID:?}" "${DEPLOY_BUCKET:?}" "${ARTIFACTS_BUCKET:?}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Config the on-box script needs, shell-quoted by jq @sh so a value can never
# break out of the export line. Secrets are not here — the box reads those from
# SSM itself.
exports=$(jq -rn \
  --arg api_image "$API_IMAGE_URI" --arg gateway_image "$GATEWAY_IMAGE_URI" \
  --arg pg_backup_image "$PG_BACKUP_IMAGE_URI" --arg prefix "$SSM_SECRET_PREFIX" \
  --arg api_host "$API_HOSTNAME" --arg apps_domain "$APPS_DOMAIN" --arg acme "$ACME_EMAIL" \
  --arg region "$AWS_REGION" --arg data_volume "$DATA_VOLUME_ID" \
  --arg deploy_bucket "$DEPLOY_BUCKET" --arg artifacts "$ARTIFACTS_BUCKET" \
  '"export API_IMAGE_URI=\($api_image|@sh) GATEWAY_IMAGE_URI=\($gateway_image|@sh) PG_BACKUP_IMAGE_URI=\($pg_backup_image|@sh) SSM_SECRET_PREFIX=\($prefix|@sh) API_HOSTNAME=\($api_host|@sh) APPS_DOMAIN=\($apps_domain|@sh) ACME_EMAIL=\($acme|@sh) AWS_DEFAULT_REGION=\($region|@sh) DATA_VOLUME_ID=\($data_volume|@sh) DEPLOY_BUCKET=\($deploy_bucket|@sh) ARTIFACTS_BUCKET=\($artifacts|@sh)"')

# The bootstrap-marker wait ensures Docker/Compose/AWS CLI are installed
# (user_data) before we deploy onto a brand-new box.
REMOTE_SCRIPT=$(cat <<REMOTE
set -euo pipefail
timeout 600 bash -c 'until [ -f /opt/nibrun-bootstrap.done ]; do echo waiting for instance bootstrap; sleep 5; done'
mkdir -p /opt/nibrun
aws s3 cp "$BUNDLE_URL" /tmp/control-plane-bundle.tar.gz
# Extract in place (no rm -rf) so the compose project keeps its identity and
# named volumes are not orphaned.
tar xzf /tmp/control-plane-bundle.tar.gz --overwrite -C /opt/nibrun
cd /opt/nibrun
${exports}
bash on_control_plane_deploy.sh
REMOTE
)
export REMOTE_SCRIPT DEPLOY_GROUP
export COMMENT="Control plane ${GITHUB_SHA:-manual}"
export MIN_INSTANCES=1

bash "$script_dir/ssm_run.sh"
