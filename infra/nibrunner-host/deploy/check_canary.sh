#!/bin/bash
set -Eeuo pipefail

cd /opt/nibrun/nibrunner-host
test ! -e /var/lib/nibrun/host-id
systemctl is-active --quiet nibrunnerd.service
DEBIAN_FRONTEND=noninteractive apt-get install -y -q busybox-static jq

desired=/var/lib/nibrunner/desired.json
reported=/var/lib/nibrunner/reported.json
if [ -e "$desired" ]; then
  jq -e '(.instances | length) == 0 and (.volumes | length) == 0' "$desired" > /dev/null
fi
if [ -e "$reported" ]; then
  jq -e 'all(.instances[]; .state == "stopped") and all(.volumes[]; .state == "deleted")' "$reported" > /dev/null
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'cat "$reported"; journalctl -u nibrunnerd.service -n 40 --no-pager' ERR
run_id=$(date +%s)
artifact=/var/lib/nibrunner/artifact-store/canary-${run_id}
install -m 0644 /usr/bin/busybox "$artifact"
digest=$(sha256sum "$artifact" | cut -d ' ' -f 1)
sed -e "s/{{RUN_ID}}/${run_id}/g" -e "s/{{BINARY_SHA256}}/${digest}/g" canary.json > "$work/desired.json"
deployment=$(jq -r '.instances[0].deploymentId' "$work/desired.json")
volume=$(jq -r '.volumes[0].volumeId' "$work/desired.json")
hostname=$(jq -r '.instances[0].hostnames[0].hostname' "$work/desired.json")

publish() {
  install -m 0600 "$work/desired.json" "${desired}.tmp"
  mv "${desired}.tmp" "$desired"
  accepted_digest=$(sha256sum "$desired" | cut -d ' ' -f 1)
}

wait_for_state() {
  for _ in $(seq 1 120); do
    if jq -e --arg deployment "$deployment" \
      'any(.instances[]; .deploymentId == $deployment and .state == "failed")' "$reported" > /dev/null; then
      return 1
    fi
    if jq -e --arg digest "$accepted_digest" --arg deployment "$deployment" --arg state "$1" \
      '.acceptedDigest == $digest and any(.instances[]; .deploymentId == $deployment and .state == $state and .restartCount == 0)' \
      "$reported" > /dev/null; then
      return
    fi
    sleep 1
  done
  return 1
}

read_guest() {
  curl --fail --silent --show-error --max-time 20 -H "Host: $hostname" "http://127.0.0.1:8080/$1"
}

publish
wait_for_state running
test "$(read_guest boots)" = 1
test "$(read_guest marker)" = nibrunner-canary
for _ in $(seq 1 180); do
  test "$(read_guest marker)" = nibrunner-canary
  sleep 1
done

for _ in $(seq 1 3); do
  wait_for_state idle
  test "$(read_guest boots)" = 1
  wait_for_state running
done

systemctl restart nibrunnerd.service
wait_for_state running
test "$(read_guest boots)" = 1

jq '.instances[0].desiredState = "stopped"' "$work/desired.json" > "$work/next.json"
mv "$work/next.json" "$work/desired.json"
publish
wait_for_state stopped
jq '.instances[0].desiredState = "running" | .instances[0].deploymentId += "-cold" | del(.instances[0].idleTimeoutMs)' \
  "$work/desired.json" > "$work/next.json"
mv "$work/next.json" "$work/desired.json"
deployment=$(jq -r '.instances[0].deploymentId' "$work/desired.json")
publish
wait_for_state running
test "$(read_guest boots)" = 2
test "$(read_guest marker)" = nibrunner-canary

jq '.instances = [] | .volumes[0].desiredState = "absent"' "$work/desired.json" > "$work/next.json"
mv "$work/next.json" "$work/desired.json"
publish
for _ in $(seq 1 120); do
  if jq -e --arg digest "$accepted_digest" --arg volume "$volume" \
    '.acceptedDigest == $digest and any(.volumes[]; .volumeId == $volume and .state == "deleted") and all(.instances[]; .state == "stopped")' \
    "$reported" > /dev/null; then
    jq '.volumes = []' "$work/desired.json" > "$work/next.json"
    mv "$work/next.json" "$work/desired.json"
    publish
    rm "$artifact"
    printf '{"loadRequests":180,"sleepWakeCycles":3,"daemonRestart":true,"persistentColdBoot":true}\n'
    exit 0
  fi
  sleep 1
done
exit 1
