#!/usr/bin/env bash
# Runs in CI. Triggers the on-box deploy on the EC2 instance over SSM (no SSH):
# finds the box, waits until it can receive commands, runs the deploy, and
# streams the result back.
# AWS credentials come from the environment (configure-aws-credentials).
set -euo pipefail

: "${BUNDLE_URL:?}" "${DEPLOY_GROUP:?}" "${SSM_SECRET_PREFIX:?}" "${AWS_REGION:?}"
: "${API_IMAGE_URI:?}" "${GATEWAY_IMAGE_URI:?}" "${PG_BACKUP_IMAGE_URI:?}"
: "${APP_HOSTNAME:?}" "${ACME_EMAIL:?}"
: "${DATA_VOLUME_ID:?}" "${DEPLOY_BUCKET:?}" "${ARTIFACTS_BUCKET:?}"

instance_id=$(aws ec2 describe-instances \
  --filters "Name=tag:DeployGroup,Values=${DEPLOY_GROUP}" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
if [ -z "$instance_id" ] || [ "$instance_id" = "None" ]; then
  echo "::error::No running EC2 instance found for DeployGroup=${DEPLOY_GROUP}"
  exit 1
fi
echo "Target instance: $instance_id"

# A freshly-created box isn't registered with SSM yet; wait so send-command lands.
echo "Waiting for the instance to register with SSM..."
ssm_online=false
for _ in $(seq 1 60); do
  ping=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=${instance_id}" \
    --query "InstanceInformationList[0].PingStatus" --output text 2>/dev/null || true)
  [ "$ping" = "Online" ] && { echo "SSM is Online."; ssm_online=true; break; }
  echo "  ssm ping: ${ping:-none}"; sleep 10
done
if [ "$ssm_online" != "true" ]; then
  echo "::error::Instance ${instance_id} did not register with SSM within 10 minutes"
  exit 1
fi

# Config the on-box script needs, shell-quoted by jq @sh so a value can never
# break out of the export line. Secrets are not here — the box reads those from
# SSM itself.
exports=$(jq -rn \
  --arg api_image "$API_IMAGE_URI" --arg gateway_image "$GATEWAY_IMAGE_URI" \
  --arg pg_backup_image "$PG_BACKUP_IMAGE_URI" --arg prefix "$SSM_SECRET_PREFIX" \
  --arg host "$APP_HOSTNAME" --arg acme "$ACME_EMAIL" --arg region "$AWS_REGION" \
  --arg data_volume "$DATA_VOLUME_ID" --arg deploy_bucket "$DEPLOY_BUCKET" \
  --arg artifacts "$ARTIFACTS_BUCKET" \
  '"export API_IMAGE_URI=\($api_image|@sh) GATEWAY_IMAGE_URI=\($gateway_image|@sh) PG_BACKUP_IMAGE_URI=\($pg_backup_image|@sh) SSM_SECRET_PREFIX=\($prefix|@sh) APP_HOSTNAME=\($host|@sh) ACME_EMAIL=\($acme|@sh) AWS_DEFAULT_REGION=\($region|@sh) DATA_VOLUME_ID=\($data_volume|@sh) DEPLOY_BUCKET=\($deploy_bucket|@sh) ARTIFACTS_BUCKET=\($artifacts|@sh)"')

# The bootstrap-marker wait ensures Docker/Compose/AWS CLI are installed
# (user_data) before we deploy onto a brand-new box.
remote_script=$(cat <<REMOTE
set -euo pipefail
timeout 600 bash -c 'until [ -f /opt/nibrun-bootstrap.done ]; do echo waiting for instance bootstrap; sleep 5; done'
mkdir -p /opt/nibrun
aws s3 cp "$BUNDLE_URL" /tmp/bundle.tar.gz
# Extract in place (no rm -rf) so the compose project keeps its identity and
# named volumes are not orphaned.
tar xzf /tmp/bundle.tar.gz --overwrite -C /opt/nibrun
cd /opt/nibrun
${exports}
bash on_box_deploy.sh
REMOTE
)

# Pass the whole script as a single command; jq handles the JSON encoding.
jq -n --arg script "$remote_script" '{commands: [$script]}' > /tmp/ssm-params.json
cmd_id=$(aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --comment "Deploy ${GITHUB_SHA:-manual}" \
  --instance-ids "$instance_id" \
  --parameters file:///tmp/ssm-params.json \
  --query "Command.CommandId" --output text)
echo "SSM command: $cmd_id"

# RunCommand is async, and a full deploy (image pulls + compose up) can run for
# several minutes — longer than the built-in `ssm wait command-executed` allows
# (~100s) — so poll until the invocation reaches a terminal state.
echo "Waiting for the deploy command to finish (up to ~15m)..."
status="Pending"
for _ in $(seq 1 90); do
  status=$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance_id" \
    --query Status --output text 2>/dev/null || echo "Pending")
  case "$status" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 10
done

echo "Status: $status"
aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance_id" \
  --query StandardOutputContent --output text || true
if [ "$status" != "Success" ]; then
  echo "::error::Deploy command did not succeed (status: $status)"
  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance_id" \
    --query StandardErrorContent --output text || true
  exit 1
fi
