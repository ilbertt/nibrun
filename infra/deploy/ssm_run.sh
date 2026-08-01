#!/usr/bin/env bash
# Runs a script on every instance carrying a DeployGroup tag, over SSM — no SSH,
# so the hosts need no inbound ports and no key material lives in CI.
#
# Shared by the control-plane and agent deploys; they differ only in what they
# put in REMOTE_SCRIPT and how many instances they expect to hit.
#
#   DEPLOY_GROUP    value of the DeployGroup tag to target (required)
#   REMOTE_SCRIPT   the script to run on each instance (required)
#   COMMENT         shows up in the SSM command history (optional)
#   MIN_INSTANCES   fail if fewer than this many are running (default 1)
#
# AWS credentials come from the environment (configure-aws-credentials).
set -euo pipefail

: "${DEPLOY_GROUP:?}" "${REMOTE_SCRIPT:?}"
COMMENT="${COMMENT:-Deploy ${GITHUB_SHA:-manual}}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"

mapfile -t instance_ids < <(
  aws ec2 describe-instances \
    --filters "Name=tag:DeployGroup,Values=${DEPLOY_GROUP}" "Name=instance-state-name,Values=running" \
    --query "Reservations[].Instances[].InstanceId" --output text | tr '\t' '\n' | awk 'NF'
)

if [ "${#instance_ids[@]}" -lt "$MIN_INSTANCES" ]; then
  echo "::error::Found ${#instance_ids[@]} running instance(s) for DeployGroup=${DEPLOY_GROUP}, expected at least ${MIN_INSTANCES}"
  exit 1
fi
echo "Target instances (${#instance_ids[@]}): ${instance_ids[*]}"

# A freshly-created box isn't registered with SSM yet; wait so send-command lands.
echo "Waiting for the instances to register with SSM..."
for _ in $(seq 1 60); do
  mapfile -t online < <(
    aws ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$(IFS=,; echo "${instance_ids[*]}")" \
      --query "InstanceInformationList[?PingStatus=='Online'].InstanceId" --output text \
      2>/dev/null | tr '\t' '\n' | awk 'NF'
  )
  [ "${#online[@]}" -eq "${#instance_ids[@]}" ] && break
  echo "  online: ${#online[@]}/${#instance_ids[@]}"
  sleep 10
done
if [ "${#online[@]}" -ne "${#instance_ids[@]}" ]; then
  echo "::error::Only ${#online[@]}/${#instance_ids[@]} instances registered with SSM within 10 minutes"
  exit 1
fi

# Pass the whole script as a single command; jq handles the JSON encoding.
jq -n --arg script "$REMOTE_SCRIPT" '{commands: [$script]}' > /tmp/ssm-params.json
cmd_id=$(aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --comment "$COMMENT" \
  --instance-ids "${instance_ids[@]}" \
  --parameters file:///tmp/ssm-params.json \
  --query "Command.CommandId" --output text)
echo "SSM command: $cmd_id"

# RunCommand is async, and a full deploy (image pulls + compose up) can run for
# several minutes — longer than the built-in `ssm wait command-executed` allows
# (~100s) — so poll until every invocation reaches a terminal state.
echo "Waiting for the deploy to finish (up to ~15m)..."
for _ in $(seq 1 90); do
  mapfile -t statuses < <(
    aws ssm list-command-invocations --command-id "$cmd_id" \
      --query "CommandInvocations[].Status" --output text 2>/dev/null | tr '\t' '\n' | awk 'NF'
  )
  pending=0
  for status in "${statuses[@]:-Pending}"; do
    case "$status" in Success|Failed|Cancelled|TimedOut) ;; *) pending=$((pending + 1)) ;; esac
  done
  [ "${#statuses[@]}" -eq "${#instance_ids[@]}" ] && [ "$pending" -eq 0 ] && break
  sleep 10
done

failed=0
for instance_id in "${instance_ids[@]}"; do
  status=$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance_id" \
    --query Status --output text 2>/dev/null || echo "Unknown")
  echo "--- ${instance_id}: ${status} ---"
  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance_id" \
    --query StandardOutputContent --output text || true
  if [ "$status" != "Success" ]; then
    failed=1
    aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance_id" \
      --query StandardErrorContent --output text || true
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "::error::Deploy did not succeed on every instance in ${DEPLOY_GROUP}"
  exit 1
fi
