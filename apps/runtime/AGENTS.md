# runtime

The guest's PID 1. It boots and supervises the tenant binary inside one microVM, and is the only
other thing that ever executes there. `src/init.c` is the sequence in order, `src/paths.h` is the
boot contract shared with the host agent, `src/vsock.h` is the port contract, and `src/config.h`
is the `/instance.env` format.

`src/guest-control.c` is the one thing here the host drives rather than reads. An export is built
by reading the block device from outside, and what has only reached ext4's journal is not in the
blocks that reader sees — so the host asks this side to freeze, which is what makes ext4
checkpoint. It answers in a child of PID 1, not on the supervisor's poll loop, which does not run
while the tenant is between restarts. The connection is the lease: dropping it thaws.

C, static, musl, because this is resident in every microVM and its cost is multiplied by how many
a host packs: measured **1.3 MiB RSS, 65 KiB on disk**. The control channel is a fork of PID 1
rather than a second binary, so what it adds is its own private pages and not another copy — the
pair measures **1.05 MiB PSS** between them. Only the tenant's binary needs glibc, which is why
the rootfs carries it and this does not link against it.

## Building

`bun run build` produces `dist/init`, which `infra/guest-image` copies to `/init` and hashes into
its own version — so the toolchain is pinned in `versions.env` and the binary is stripped and
build-id-free, to keep a rebuild byte-identical. A change that is not reproducible turns every
guest-image build into a new version.

## Testing

`bun run test` runs three Docker suites: unit, mount (every mount against a real kernel, with loop
devices for the drives) and boot (the real `/init` as PID 1, start to finish). Boot deliberately
avoids `--privileged`, which would hand the container the host's own `/dev`, where `vdb` is a real
disk.

Verified on Firecracker v1.16.1: the boot sequence, data persisting across boots, a spent restart
budget ending the VM with Firecracker exiting 0, and a graceful stop over `SendCtrlAltDel` — which
works only because the guest kernel enables the i8042 path, and that belongs to
`infra/guest-image`.

The stdout/stderr framing and non-blocking capture are exercised in Docker, and so is freeze and
thaw against a real ext4 loop device — a frozen filesystem cannot be asked whether it is frozen,
so what the mount suite asserts is the pair of refusals, EBUSY on a second freeze and EINVAL on a
second thaw. Neither AF_VSOCK leg is covered: a container has no Firecracker vsock backend, so
the log connection and the control channel's handshake both still need a Firecracker integration
test. The host's half of that handshake is covered in `apps/agent`, against a fake VMM.
