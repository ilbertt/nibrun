#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
umask 077
exec 9>/run/nibrunner-tunnel-deploy.lock
flock -w 300 9

: "${AWS_REGION:?}" "${NIBRUNNER_CLOUDFLARED_TOKEN_PARAMETER:?}"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -q awscli curl ca-certificates
install -d -m 0755 /usr/share/keyrings
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL --retry 3 https://pkg.cloudflare.com/cloudflare-main.gpg -o "$work/cloudflare-main.gpg"
install -m 0644 "$work/cloudflare-main.gpg" /usr/share/keyrings/cloudflare-main.gpg
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  > /etc/apt/sources.list.d/cloudflared.list
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -q cloudflared

aws ssm get-parameter --region "$AWS_REGION" --name "$NIBRUNNER_CLOUDFLARED_TOKEN_PARAMETER" \
  --with-decryption --query Parameter.Value --output text > "$work/token"
if [ ! -s "$work/token" ] || [ "$(cat "$work/token")" = None ]; then
  echo "the Cloudflare Tunnel token is missing" >&2
  exit 1
fi

install -d -m 0700 /etc/nibrunner/cloudflared
install -m 0600 "$work/token" /etc/nibrunner/cloudflared/token.next
mv -f /etc/nibrunner/cloudflared/token.next /etc/nibrunner/cloudflared/token
install -m 0644 nibrun-nibrunner-tunnel.service /etc/systemd/system/nibrun-nibrunner-tunnel.service
systemctl daemon-reload
systemctl enable nibrun-nibrunner-tunnel.service
systemctl restart nibrun-nibrunner-tunnel.service

for _ in $(seq 1 60); do
  if cloudflared tunnel --metrics 127.0.0.1:2000 ready; then
    systemctl is-active --quiet nibrun-nibrunner-tunnel.service
    exit 0
  fi
  sleep 1
done
echo "the Cloudflare Tunnel did not become ready" >&2
exit 1
