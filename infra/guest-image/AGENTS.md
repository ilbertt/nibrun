# guest-image

The Firecracker guest: an uncompressed kernel ELF and a glibc rootfs, built reproducibly in a
container and published under a version of their own. Docker is the only host dependency. Not a
workspace package — same shape as `pg-backup/`. Every pinned input and the reason for it is in
`versions.env`.

Build target is `vmlinux`. Firecracker loads an uncompressed ELF and runs no real-mode
decompressor, so a `bzImage` is not a smaller version of the right thing — it is the wrong thing.

## The boot contract

Firecracker assigns virtio-blk devices in the order the `drives` array declares them, so the
order *is* the contract.

| Device | Contents | Mode | `cache_type` |
|---|---|---|---|
| `vda` | this rootfs | ro, `is_root_device` | `Unsafe` |
| `vdb` | tenant artifact: squashfs holding the binary at `/server` | ro | `Unsafe` |
| `vdc` | instance config: squashfs holding `/instance.env` | ro | `Unsafe` |
| `vdd` | tenant data: the NBD device ZeroFS serves, ext4 | rw | **`Writeback`** |

```
console=ttyS0 quiet reboot=k panic=1 pci=off i8042.noaux i8042.nomux i8042.dumbkbd root=/dev/vda ro init=/init ip=<guest-ip>::<host-ip>:<netmask>::eth0:off
```

`quiet` keeps informational kernel messages out of the serial console that carries the tenant's
stdout and stderr. Kernel warnings and failures remain visible, and writes to `/dev/console` are
unaffected.

`cache_type` on `vdd` is the one setting that fails silently: Firecracker defaults a drive to
`Unsafe`, which **discards flush requests**, so the guest's `fsync` returns success, ZeroFS is
never told to flush, and the loss window stops being the 5 s flush interval and becomes
unbounded. Nothing looks wrong until a host dies.

Three `i8042.*` flags, not the usual four. The image builds the i8042 driver because a graceful
stop needs it, so the probe exists and skipping the parts of it we have no device for is worth
0.4 s — measured here, 1.01–1.07 s without the flags against 0.61–0.74 s with them.

**`i8042.nopnp` is deliberately absent.** It breaks `SendCtrlAltDel` on an ACPI-enabled guest,
which ours is, and Firecracker dropped it from their own default cmdline for that reason.
Measured: with it on the cmdline the guest ignores the action entirely.

The static `ip=…:off` form is why the image ships no DHCP client.

## What the image gives `/init`

`/init` is PID 1, comes from `apps/runtime`, and is the only thing here that executes besides
the tenant binary. There is no shell, package manager, init system or login.

The root is read-only for the life of the VM, and **a mount point cannot be created on a
read-only root** — so `/proc`, `/sys`, `/dev`, `/tmp`, `/run`, `/mnt/artifact` and `/app` exist
in the image for that reason alone. The contract fixes only that the tenant sees its data at
`data/` relative to its working directory; this image proposes `/app` as that directory. **If
`apps/runtime` picks a different path, that path must be added here, because it cannot be
created at boot.**

`/etc/resolv.conf` symlinks into `/run` because nothing may write to the root. `/etc/passwd`
names `root` and `nobody` at Debian's numbering, for the tenant's own `getpwuid`.

Measured at boot, PID 1 receives `argv = ["/init"]` and `envp = {HOME=/, TERM=linux}`: the kernel
forwards no command-line tokens, not even ones it did not consume. Anything from the cmdline has
to be read out of `/proc/cmdline`.

The rootfs carries glibc, `libgcc-s1`, `libstdc++6` and the CA bundle and nothing else.
`bun build --compile` targets glibc, and Alpine/musl fails at exec with an opaque error — which
is why the base is Debian rather than the smaller obvious choice.

## The kernel config is used off-label

Firecracker publishes `resources/guest_configs/*` for the **Amazon Linux microVM kernels** and
does not guarantee them against a vanilla kernel.org tree. We use kernel.org anyway — a
tarball with a published sha256 is a stronger thing to hash than a GitHub source archive — and
pay for it by naming every divergence in `kernel/config-drift.allow`.

That file is enforced: every assignment in the base config must survive into the generated
`.config` unless listed there or deliberately overridden. The whole measured divergence is
thirteen lines. The only one worth knowing: `CONFIG_SYSGENID`, which tells userspace to reseed
its RNG after a snapshot restore. **nibrun takes no Firecracker snapshots — if it ever does,
this is the missing symbol and the reason to move onto the Amazon Linux source tree.**

`assert-config.sh` exists because kconfig drops a symbol whose dependencies are unmet **without
failing**. A fragment is a request, not a guarantee, and the classic way to lose virtio-blk is
never being told you did. `CONFIG_PCI=y` is asserted despite `pci=off`, because the flag only
suppresses bus scanning while x86_64 ACPI init still needs the symbol.

## Building

```sh
./build.sh                          # needs apps/runtime/dist/init
GUEST_IMAGE_STUB_INIT=1 ./build.sh  # throwaway /init, for working on the image alone
./version.sh                        # just the version, no Docker
```

The version is `<kernel-version>-<12 hex>` over every file here plus the runtime binary, rather
than a hand-maintained file whose failure mode is forgetting to bump it and publishing a
different image under a version already on the hosts. It deliberately over-approximates — editing
this doc costs one rebuild, where an uncovered input would ship a different artifact under an
adopted version. Only one of those is recoverable. It needs no Docker, which is what lets CI
compute it first and decide whether to build at all.

A stub build changes the version and sets `"init_is_stub": true`, so it can never be mistaken
for a publishable one. Publishing and adopting are separate and neither is owned here — see
`infra/app-host/AGENTS.md`.

Nothing is ever mounted: the rootfs is written with `mkfs.ext4 -d`, so no loop device, no
privileged container, and the host kernel never parses a filesystem image.

## What has actually been booted

**Under Firecracker v1.16.1 on x86_64 with `/dev/kvm`, with the real `/init` and all four
drives.** The whole contract above is measured, not assumed: `vda`…`vdd` enumerate in
declaration order, the artifact mount is read-only from inside the guest, the tenant runs as
uid 65534 with cwd `/app` and its data at `/app/data`, `PORT` and the tenant's own environment
arrive from `vdc`, and the data disk survives a reboot. Boot to `Run /init` is 0.59–0.66 s.

The restart budget was exercised too: a tenant that exits immediately is restarted with
200/400/800 ms backoff, three times as configured, after which the guest powers itself off —
which is what leaves the agent to report the instance failed rather than a VM retrying forever.

A graceful stop works: `SendCtrlAltDel` reaches `/init`, which asks the tenant to stop and then
shuts the guest down. **This fails silently when it is wrong** — the API answers 204 and the VMM
reports success whether or not the guest can hear it, so it was verified by watching the VMM
exit, not by the response code.

Firecracker appends `pci=off root=/dev/vda ro` and the `virtio_mmio.device=` entries to whatever
`boot_args` it is given, so the cmdline above duplicates three tokens. Harmless, and worth
knowing before someone "fixes" it.

CI has no x86 runner with `/dev/kvm`, so this boot is a manual step today. It should become a
gate on publishing.

**The version is deterministic and verified.** Byte-identical artifacts hold **on one machine**:
two independent full kernel compiles, from source trees edited between them in ways that left
the generated `.config` unchanged, produced the same `vmlinux` sha256. **Across machines it is
untested** — everything known to make it so is in place, but no runner-versus-laptop comparison
has been run. Treat that half as intended, not proven.
