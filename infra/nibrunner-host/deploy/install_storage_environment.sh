#!/bin/bash
set -euo pipefail
umask 077

: "${AWS_REGION:?}" "${NIBRUNNER_ZEROFS_ENCRYPTION_PASSWORD_PARAMETER:?}"

install -d -m 0700 /etc/nibrunner
work=$(mktemp -d /etc/nibrunner/.storage.XXXXXX)
trap 'rm -rf "$work"' EXIT

password=$(aws ssm get-parameter --region "$AWS_REGION" \
  --name "$NIBRUNNER_ZEROFS_ENCRYPTION_PASSWORD_PARAMETER" \
  --with-decryption --query Parameter.Value --output text)
test -n "$password"
printf 'AWS_REGION=%s\nZEROFS_ENCRYPTION_PASSWORD=%s\n' "$AWS_REGION" "$password" > "$work/host.env"

if ! cmp -s "$work/host.env" /etc/nibrunner/host.env; then
  install -m 0600 "$work/host.env" /etc/nibrunner/host.env
fi
