# runtime

The guest's PID 1. `/init` mounts what the guest needs, reads the instance config off
its own drive, gives the tenant its volume at `data/`, drops privileges, and
supervises the process until it is asked to stop or runs out of restarts. It and the
tenant binary are the only two things that ever execute in the VM.

C, static, musl — this is resident in every microVM, so its memory is multiplied by
how many a host packs. Measured: **1.3 MiB RSS, 62 KiB on disk**. Only the tenant's
binary needs glibc, which is why the rootfs carries it.

## The sequence

`/dev` (only if the kernel has not already — it has, `CONFIG_DEVTMPFS_MOUNT`), the
console, `/proc` `/sys` `/run` `/tmp` `/dev/shm`, the config drive read and then
unmounted, `/run/resolv.conf`, the artifact drive, a root-owned tmpfs at `/app` with
the data device mounted at `/app/data` and given to the tenant, then the tenant.
Any failure before that last step ends the machine with the reason on the console: a
tenant started without its volume would look healthy and lose everything it wrote.

## /instance.env — the contract with the agent

Line-oriented `KEY=VALUE`, generated per boot. Two namespaces, and a line in neither
is rejected: `NIBRUN_<KEY>` for the runtime, `ENV_<NAME>` for a tenant variable. The
prefixes are what makes them impossible to confuse — a tenant variable called
`NIBRUN_PORT` arrives as `ENV_NIBRUN_PORT` and stays the tenant's.

`NIBRUN_PORT` becomes `PORT`. `NIBRUN_MAX_RESTARTS`, `NIBRUN_INITIAL_BACKOFF_MS`,
`NIBRUN_MAX_BACKOFF_MS`, `NIBRUN_BACKOFF_FACTOR` and `NIBRUN_RESET_AFTER_MS` are
`RestartPolicy`. All six are required — **the runtime carries no defaults**, because
`DEFAULT_RESTART_POLICY` in `packages/protocol` is the only place they exist and a
missing key is a bug in the writer. `NIBRUN_DNS` takes up to three comma-separated
resolvers and is the one optional key; the agent should always emit it, since without
it the tenant resolves nothing.

Rejected loudly, before the tenant starts: an unknown `NIBRUN_` key, a duplicate, a
name that is not `[A-Za-z_][A-Za-z0-9_]*`, a line under neither prefix, a NUL, a CR.
**A tenant value may not contain a newline** — unrepresentable here, so it fails the
boot rather than reaching the tenant truncated; better rejected in the API.
`ENV_PORT` is dropped: the platform owns the port it probes and routes to. The tenant
also gets `HOME=/app` and `TMPDIR=/tmp` if it did not set them itself.

## Restarting, stopping, and what is logged

The guest restarts the tenant with backoff until the budget is spent, resetting the
count for a process that stayed up past `resetAfterMs`. Then it **ends the machine**
rather than trying again: the agent observes the exit and reports the instance
failed, and what happens next is the reconciler's. A host that retried forever would
hide a broken deploy. Any exit counts — a server that exited is not serving.

`SendCtrlAltDel` reaches PID 1 as SIGINT only because `/init` calls
`reboot(RB_DISABLE_CAD)` first; the default is to reset the machine on the spot with
the tenant mid-write. Then SIGTERM to the tenant's group, **10 s** (the agent's wait
for the VM to exit must exceed this), SIGKILL, unmount, `sync`, and
`reboot(RB_AUTOBOOT)` — a guest *reset* is the only thing Firecracker turns into "the
microVM exited"; a power-off leaves the VMM running with nobody inside it.

Tenant output is the guest console, unwrapped and unbuffered, so `journalctl -u
nibrun-vm@<id>` gives an operator the app's output for free. The runtime's own lines
share it, prefixed `[nibrun] `, one `write(2)` each. Nothing from `/instance.env` is
ever logged — not values, not even tenant variable names.

## Building and testing

`bun run build` produces `dist/init`, which `infra/guest-image` copies to `/init` and
hashes into its version — hence the pinned toolchain in `versions.env` and the
stripped, build-id-free binary, which rebuild byte-identically.

`bun run test` runs three Docker suites: **unit** (parsing, environment, backoff,
budget, shutdown forwarding, reaping, the privilege drop), **mount** (every mount
against a real kernel with loop devices for the drives, including both halves of the
`CONFIG_DEVTMPFS_MOUNT` case, which cost one boot on hardware to learn) and **boot**
(the real `/init` as PID 1, start to finish). Boot avoids `--privileged`, which would
hand the container the host's own `/dev`, where `vdb` is a real disk.

A boot under Firecracker v1.16.1 confirmed the sequence, data persisting across
boots, and a spent budget ending the VM with Firecracker exiting 0.
**`SendCtrlAltDel` itself is still unverified**: the pinned kernel has `SERIO_I8042`,
`KEYBOARD_ATKBD`, `ACPI_BUTTON` and `ACPI_TINY_POWER_BUTTON` off, so nothing in the
guest can receive it, and Firecracker dropped `i8042.nopnp` from its own cmdline
because it breaks that path on an ACPI guest. Both belong to `infra/guest-image`.
