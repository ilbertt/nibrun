# runtime

The guest's PID 1. It boots and supervises the tenant binary inside one microVM, and is the only
other thing that ever executes there. `src/init.c` is the sequence in order, `src/paths.h` is the
boot contract shared with the host agent, `src/vsock.h` is the port contract, and `src/config.h`
is the `/instance.env` format.

`src/guest-control.c` and `src/guest-filesystem.c` are the two things here the host drives rather
than reads, and both exist because the host's view of the block device is not the filesystem.

An export is built by reading that device from outside, and what has only reached ext4's journal
is not in the blocks the reader sees — so the host asks the control channel to freeze, which is
what makes ext4 checkpoint. The connection is the lease: dropping it thaws.

Browsing is the same gap in the other direction. A listing read from the device lags the tenant's
last write by ZeroFS's flush interval, and a device the guest has mounted read-write cannot be
written at all. `src/guest-filesystem.c` answers a `readdir` instead, on a port of its own —
never on the control port, which takes one connection at a time and holds it for the length of an
export. Its wire format is in `src/guest-filesystem.h`.

Two of its verbs answer about the guest rather than about a file in it: how full the volume is,
and what the machine is spending, read out of `/proc`. Neither earned a port of its own — a
listener is another fork of PID 1, and its memory is part of what the second one measures.

Both answer in a child of PID 1, not on the supervisor's poll loop, which does not run while the
tenant is between restarts. Neither allocates: `getdents` rather than `opendir`, two bounded
buffers on the stack of whoever is answering, and a request that cannot make either grow. The
tenant is meant to be the only thing in this guest that allocates, which is what makes it the
right thing for the OOM killer to reach for.

C, static, musl, because this is resident in every microVM and its cost is multiplied by how many
a host packs: measured **1.3 MiB RSS, 69 KiB on disk**. Both channels are forks of PID 1 rather
than separate binaries, so each adds its own private pages and not another copy — the three
together measure **1.3 MiB PSS**, barely more than PID 1 costs alone and a fifth more than the
pair did before the filesystem channel existed. Only the tenant's binary needs glibc, which is why
the rootfs carries it and this does not link against it.

## Building

`bun run build` produces `dist/init`, which `infra/guest-image` copies to `/init` and hashes into
its own version — so the toolchain is pinned in `versions.env` and the binary is stripped and
build-id-free, to keep a rebuild byte-identical. A change that is not reproducible turns every
guest-image build into a new version.

## Testing

`bun run test` runs three Docker suites: unit (everything that needs only a process, including the
filesystem channel against an ordinary directory), mount (every mount against a real kernel, with
loop devices for the drives) and boot (the real `/init` as PID 1, start to finish). Boot
deliberately avoids `--privileged`, which would hand the container the host's own `/dev`, where
`vdb` is a real disk.

Verified on Firecracker v1.16.1: the boot sequence, data persisting across boots, a spent restart
budget ending the VM with Firecracker exiting 0, and a graceful stop over `SendCtrlAltDel` — which
works only because the guest kernel enables the i8042 path, and that belongs to
`infra/guest-image`.

The stdout/stderr framing and non-blocking capture are exercised in Docker, and so is the control
channel against a real ext4 loop device. A frozen filesystem cannot be asked whether it is
frozen, and a write that proved it would be a write that never returns, so what the mount suite
asserts is the pair of refusals: EBUSY on a second freeze, EINVAL on a second thaw. The lease
loop is driven over a socketpair standing in for the vsock — a host that lets go, one that never
does, and one that asks for something else — because the property worth proving is that the
tenant gets its filesystem back however the connection ended.

The filesystem channel is driven over the same substitution, in the unit suite because a plain
directory is all its verbs need: that a name holding a space, a quote or a newline survives the
round trip, that `..` and a symlink out of the mount are refused whichever verb asks, that a file
crosses byte for byte in both directions, and that bytes which are not a frame or a peer that
leaves mid-request end that connection and nothing else.

What that leaves uncovered is the AF_VSOCK transport itself, for every leg: a container has no
Firecracker vsock backend, so the log connection and both `CONNECT` handshakes still need a
Firecracker integration test. The host's half of them is covered in `apps/agent`, against a fake
VMM.
