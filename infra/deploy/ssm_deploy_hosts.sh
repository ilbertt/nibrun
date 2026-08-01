#!/usr/bin/env bash
# Runs in CI. Rolls the agent binary out to every compute host at once.
#
# Order matters when the host token has changed: deploy the control plane first,
# or hosts will present a token the api no longer accepts.
set -euo pipefail

: "${BUNDLE_URL:?}" "${DEPLOY_GROUP:?}" "${SSM_SECRET_PREFIX:?}" "${AWS_REGION:?}"
: "${API_HOSTNAME:?}"

VOLUMES_DIR="${VOLUMES_DIR:-/var/lib/nibrun/volumes}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exports=$(jq -rn \
  --arg prefix "$SSM_SECRET_PREFIX" --arg api_host "$API_HOSTNAME" \
  --arg region "$AWS_REGION" --arg volumes_dir "$VOLUMES_DIR" \
  '"export SSM_SECRET_PREFIX=\($prefix|@sh) API_HOSTNAME=\($api_host|@sh) AWS_DEFAULT_REGION=\($region|@sh) VOLUMES_DIR=\($volumes_dir|@sh)"')

REMOTE_SCRIPT=$(cat <<REMOTE
set -euo pipefail
timeout 600 bash -c 'until [ -f /opt/nibrun-bootstrap.done ]; do echo waiting for instance bootstrap; sleep 5; done'
mkdir -p /opt/nibrun
aws s3 cp "$BUNDLE_URL" /tmp/agent-bundle.tar.gz
tar xzf /tmp/agent-bundle.tar.gz --overwrite -C /opt/nibrun
cd /opt/nibrun
${exports}
bash on_host_deploy.sh
REMOTE
)
export REMOTE_SCRIPT DEPLOY_GROUP
export COMMENT="Agent ${GITHUB_SHA:-manual}"
export MIN_INSTANCES="${MIN_INSTANCES:-1}"

bash "$script_dir/ssm_run.sh"
