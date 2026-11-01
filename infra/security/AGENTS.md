# Security maintenance

`install_ipv4_options_filter.sh` installs a separate, atomically replaced nftables table and
a boot-persistent systemd service. The control-plane, app-host and nibrunner deploys carry the
same installer. For an existing host or the port relay, run:

```sh
AWS_REGION=eu-central-1 bun run --filter @repo/internal-scripts ssm-mitigate-ipv4-options i-INSTANCE_ID
```

Pass explicit instance IDs. No discovery query may silently become a mutation target.
The filter drops IPv4 TCP packets carrying IP options before routing and on local output,
covering hosts, forwarded guest traffic and locally generated guest connections. Ordinary TCP
options remain allowed. It never flushes another table or restarts a tenant service.

This is exposure reduction for [CVE-2026-98432](https://access.redhat.com/security/vulnerabilities/RHSB-2026-016),
not proof of protection. Keep it until hosts and all guest kernels are patched. A global
`nft flush ruleset` removes it; reload `nibrun-ipv4-options.service` after any such operation.
To remove it after rollout, disable the service, delete only `inet nibrun_ipv4_options`,
and remove the installer calls from deployment bundles.

Kernel maintenance requires checking the **running** kernel after a controlled reboot. AL2023
locks repositories to a release: `dnf update` without an explicitly selected patched
`--releasever` can leave a host behind. Never reboot an app host before stopping admission,
gracefully stopping its guests and flushing its storage through the existing lifecycle.
Never start a second ZeroFS writer as a rollout shortcut.

Publishing a guest image and adopting it are separate steps. `infra/app-host/versions.json`
must name an uploaded, validated artifact, not a locally calculated candidate. Adoption changes
future cold boots; running guests must be replaced, and old snapshots must not be restored.
The nibrunner release carries its own guest kernel and needs an independent update.
