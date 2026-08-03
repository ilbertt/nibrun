# agent

The nibrun host agent. One compiled binary per app host: it opens a session with the control
plane, long-polls for desired state, converges the host onto it, and reports what it observes. It
is never sent a command. Every decision behind that is commented at the definition it applies to —
read `reconcile/`, `volumes/topology.ts` and `network/allocator.ts` first.

**No third-party dependencies, deliberately.** Bun's built-ins cover HTTP, S3, hashing, process
spawning and file I/O, and `@repo/protocol` is the only import. That is what keeps the binary small
and its supply chain trivial, and it is why everything the host does that Bun cannot do is a
subprocess (`systemctl`, `ip`, `nft`, `nbd-client`, `mkfs.ext4`, `mksquashfs`, `zerofs`) rather
than a library. Adding a dependency needs a reason that survives that trade.

## What the host must provide, and does not yet

Owned by `infra/app-host/`, not fixable here.

- **A mount of the ZeroFS filesystem.** `[servers.ninep]` is configured and nothing mounts it, so
  volume provisioning fails at its first step. The admin RPC cannot create files, so there is no
  way to do this over the socket the agent already uses.
- **`iproute2`, `nftables`, `nbd-client`, `e2fsprogs`, `squashfs-tools`.** Each is a subprocess the
  agent shells out to, and nothing installs any of them.
- **`net.ipv4.ip_forward=1`**, and a base `FORWARD` policy of `ACCEPT`. The agent owns
  `table ip nibrun` and expresses isolation as `drop` rules, which are final wherever they appear;
  its `accept` rules only end its own chain, so it composes with a coexisting ruleset but cannot
  open one that is closed.

## What is not tested

Everything that needs a hypervisor, a Linux kernel or AWS — this was written on macOS with no AWS
credentials, and the gap is wider than the test count suggests.

- **The nftables ruleset is rendered and asserted as text, never loaded.** Proving the isolation
  rules needs a booted guest trying to reach `169.254.169.254`, its neighbour and the control
  plane.
- **The Firecracker config is asserted as a structure, never booted.** Firecracker validates it
  with `deny_unknown_fields`, so a typo is a hard error at boot and nowhere earlier.
- **Every subprocess argument list is unasserted** — only the parsers for their *output* are
  tested. In particular nothing has confirmed that a `truncate` onto a `zerofs` mount produces a
  device file ZeroFS then exports, which is the one step the whole volume path rests on.
- **S3 and IMDS** are tested against stubs; nothing has spoken to AWS.
- The Firecracker drive-on-`/dev/nbdN` path is upstream-undocumented — mechanically sound, never
  run here.
