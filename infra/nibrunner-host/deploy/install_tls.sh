#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
umask 077
exec 9>/run/nibrunner-tls-deploy.lock
flock -w 300 9

: "${AWS_REGION:?}" "${NIBRUNNER_TLS_CERT_PARAMETER:?}" "${NIBRUNNER_TLS_KEY_PARAMETER:?}"

if ! command -v aws >/dev/null || ! command -v openssl >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y awscli openssl
fi

root=/etc/nibrunner/tls
install -d -m 0700 "$root" "$root/versions"
work=$(mktemp -d "$root/.staging.XXXXXX")
trap 'rm -rf "$work" "$root/current.next"' EXIT

aws ssm get-parameter --region "$AWS_REGION" --name "$NIBRUNNER_TLS_CERT_PARAMETER" \
  --with-decryption --query Parameter.Value --output text | base64 --decode > "$work/origin.crt"
aws ssm get-parameter --region "$AWS_REGION" --name "$NIBRUNNER_TLS_KEY_PARAMETER" \
  --with-decryption --query Parameter.Value --output text | base64 --decode > "$work/origin.key"
cp origin-pull-ca.pem "$work/origin-pull-ca.pem"

openssl x509 -in "$work/origin.crt" -checkend 0 -noout >/dev/null
openssl x509 -in "$work/origin-pull-ca.pem" -checkend 0 -noout >/dev/null
certificate_key=$(openssl x509 -in "$work/origin.crt" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
private_key=$(openssl pkey -in "$work/origin.key" -passin pass: -pubout -outform DER | sha256sum)
if [ "$certificate_key" != "$private_key" ]; then
  echo "the origin TLS certificate and private key do not match" >&2
  exit 1
fi

digest=$(cat "$work/origin.crt" "$work/origin.key" "$work/origin-pull-ca.pem" | sha256sum | cut -d ' ' -f 1)
version="$root/versions/$digest"
if [ -d "$version" ]; then
  for name in origin.crt origin.key origin-pull-ca.pem; do
    if ! cmp -s "$work/$name" "$version/$name"; then
      echo "the stored TLS version differs from the validated material" >&2
      exit 1
    fi
  done
else
  mv "$work" "$version"
fi

if [ "$(readlink "$root/current" || true)" != "$version" ]; then
  ln -sfn "$version" "$root/current.next"
  mv -Tf "$root/current.next" "$root/current"
fi
