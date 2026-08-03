# runtime

The guest's PID 1. It boots and supervises the tenant binary inside one microVM, and is the only
other thing that ever executes there. `src/init.c` is the sequence in order, `src/paths.h` is the
boot contract shared with the host agent, and `src/config.h` is the `/instance.env` format.

C, static, musl, because this is resident in every microVM and its cost is multiplied by how many
a host packs: measured **1.3 MiB RSS, 62 KiB on disk**. Only the tenant's binary needs glibc,
which is why the rootfs carries it and this does not link against it.

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
