# CVE-2026-98432 rollout status — 2026-11-01

This change is not a completed security rollout. Production changes require PR review and
explicit rollout approval. No further production changes are authorized by this document.

## Changes already applied outside the PR

The IPv4 TCP-options mitigation in `install_ipv4_options_filter.sh` was applied to:

- `nibrun` (control plane)
- `nibrun-app-host-0`
- `nibrun-port-relay`
- `nibrun-nibrunner-host`

Each now has `inet nibrun_ipv4_options`, `/etc/nibrun/ipv4-options.nft`, and the enabled
`nibrun-ipv4-options.service`. The installer installs nftables if missing. Existing firewall
tables were retained. The service and table were checked on all four hosts; the dashboard and
auth health endpoints returned HTTP 200, the control-plane containers reported healthy, and the
app-host agent/proxy and nibrunner metrics remained available. No tenant restart was requested.

The command for `nibrun-ssh-relay-test` remained pending and was cancelled. Its mitigation is
unverified. No host kernel update, reboot, guest image adoption, application deployment, or
dependency deployment was performed as part of this work.

## Rollback, only after approval

On each affected host:

```sh
sudo systemctl disable --now nibrun-ipv4-options.service
sudo nft delete table inet nibrun_ipv4_options
sudo rm -f /etc/systemd/system/nibrun-ipv4-options.service /etc/nibrun/ipv4-options.nft
sudo systemctl daemon-reload
```

This removes only the added mitigation. It reopens the filtered attack path while the kernel
remains vulnerable. Do not flush the global ruleset. Deployment installer calls in this PR
must also be removed if rollback is intended to persist across future deployments.

## Outstanding remediation

| Component | Observed | Required |
| --- | --- | --- |
| Control plane and app-host kernel | `6.18.41-94.142.amzn2023.x86_64` | Patched AL2023 release and controlled reboot |
| Port relay kernel | `6.18.48-109.150.amzn2023.x86_64` | Patched AL2023 release and controlled reboot |
| SSH test host kernel | `6.18.44-99.149.amzn2023.aarch64` | Restore management access, patch and verify |
| Nibrunner host kernel | `7.0.0-1016-aws` | Ubuntu vendor fix and controlled reboot; advisory still lists fix in progress |
| Legacy guest kernel | Adopted `6.1.180-a9ee73790531` | Build, boot-test, publish and adopt patched image; replace existing guests |
| Nibrunner guest kernel | Release `v2026.10.7` manifest pins `6.1.180` | Separate nibrunner release with patched guest kernel |
| App-host Caddy | `2.11.4` | Deploy verified `2.11.7` pin |
| Control-plane Caddy | `2.11.7` | Already meets the checked advisory's patched version |
| JavaScript dependencies | Updated separately in [PR #1101](https://github.com/ilbertt/nibrun/pull/1101) | Review and deploy the dependency PR; distribute rebuilt CLI |

The guest kernel and rootfs updates are reviewed separately in
[PR #1112](https://github.com/ilbertt/nibrun/pull/1112). Its candidate kernel is `6.1.191`, with
the Debian snapshot advanced to 2026-10-31. Follow that PR for build and boot validation.
Publishing, adoption and a controlled cold restart of existing guests are separate steps;
this host-mitigation PR does not change the guest image. Nibrunner also needs its own release
with a patched kernel.

Dependency updates, the Monaco sanitizer patch, and the dependency advisory CI gate are
reviewed separately in [PR #1101](https://github.com/ilbertt/nibrun/pull/1101). Its updated
lockfile has no high or critical audit findings; this infrastructure PR retains the original
dependency versions.
Docker service and API runtime image updates are reviewed separately in
[PR #1103](https://github.com/ilbertt/nibrun/pull/1103). Docker Caddy keeps its existing
`2.11-alpine` tag, which receives compatible patch releases when the deploy pulls images.
The app-host Caddy binary update remains here because its installer verifies a fixed archive
checksum.

The legacy Firecracker processes were also observed running as root, without the launcher
using the jailer. That isolation gap needs a separately reviewed implementation and boot,
snapshot, storage and network tests; this PR does not resolve it.

## Advisory evidence

- [Linux CVE announcement and fixed versions](https://kernel.googlesource.com/pub/scm/linux/security/vulns/+/refs/heads/master/cve/published/2026/CVE-2026-98432.mbox)
- [Red Hat mitigation limitations](https://access.redhat.com/security/vulnerabilities/RHSB-2026-016)
- [AL2023 6.18 fix, including additional kernel CVEs](https://alas.aws.amazon.com/AL2023/ALAS2023-2026-3251.html)
- [Ubuntu fix status](https://ubuntu.com/security/CVE-2026-98432)
- [Debian glibc residual issues](https://security-tracker.debian.org/tracker/source-package/glibc)
- [Debian zlib residual issues](https://security-tracker.debian.org/tracker/source-package/zlib)

The filter is temporary exposure reduction, not a substitute for patching. The checked
upstream libraries still have open issues, and tenant-uploaded binaries carry dependencies
outside this repository's lockfile. This audit is not a claim that every vulnerability is fixed.
