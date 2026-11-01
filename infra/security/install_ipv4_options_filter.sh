#!/bin/bash
set -euo pipefail

if ! command -v nft >/dev/null; then
  if command -v dnf >/dev/null; then
    dnf install -y nftables
  else
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y nftables
  fi
fi

rules=$(mktemp)
trap 'rm -f "$rules"' EXIT
cat > "$rules" <<'NFT'
table inet nibrun_ipv4_options
delete table inet nibrun_ipv4_options
table inet nibrun_ipv4_options {
  chain prerouting {
    type filter hook prerouting priority -310; policy accept;
    ip protocol tcp ip hdrlength > 5 counter drop
  }
  chain output {
    type filter hook output priority -310; policy accept;
    ip protocol tcp ip hdrlength > 5 counter drop
  }
}
NFT

nft --check --file "$rules"
install -d -m 0755 /etc/nibrun
install -m 0644 "$rules" /etc/nibrun/ipv4-options.nft

cat > /etc/systemd/system/nibrun-ipv4-options.service <<EOF
[Unit]
Description=nibrun IPv4 TCP options mitigation
After=nftables.service
Before=docker.service nibrun-agent.service nibrunnerd.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$(command -v nft) --file /etc/nibrun/ipv4-options.nft
ExecReload=$(command -v nft) --file /etc/nibrun/ipv4-options.nft

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nibrun-ipv4-options.service
if systemctl is-active --quiet nibrun-ipv4-options.service; then
  systemctl reload nibrun-ipv4-options.service
else
  systemctl start nibrun-ipv4-options.service
fi
nft list table inet nibrun_ipv4_options
