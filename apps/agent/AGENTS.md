# agent

The nibrun host agent. One compiled binary per app host: it opens a session with the control
plane, long-polls for desired state, converges the host onto it, and reports what it observes. It
is never sent a command. Read `reconcile/`, `volumes/topology.ts` and `network/slot.ts` first.

**Written in Effect.** Every effectful path is an `Effect` with a typed error channel; anything a
test needs to substitute is a service (`Context.Tag` or `Effect.Service`) wired in `index.ts` and
nowhere else. State that used to be mutable class fields lives in a `Ref`. The four loops in
`agent/` are fibers, and their retry cadence is a `Schedule` rather than a failure counter.
Interruption is the shutdown path: `BunRuntime.runMain` cancels the fibers and scoped finalizers
close the log sockets. Nothing stops a tenant VM, which is what keeps redeploying the agent free.

**Everything the host does that Bun cannot do is a subprocess** (`systemctl`, `ip`, `nft`,
`nbd-client`, `mkfs.ext4`, `mksquashfs`, `zerofs`) rather than a library, through the
`CommandRunner` service over `@effect/platform`'s `Command`. Bun's own S3 client and hasher are
still used directly, because `@effect/platform` has no equivalent.

**Every failure is a `Data.TaggedError` that renders itself.** Its `get message()` is what a
report carries to the control plane and from there to whoever is looking at a failed instance, so
it reads as a sentence and names no value a tenant owns. Callers match on `_tag` — `catchTag`,
`catchTags`, `tapErrorTag` — never `instanceof`; `describe`/`reportedMessage` in `lib/failure.ts`
are the only formatters. A plain `Error` crossing in from `@repo/protocol` is tagged at the
boundary in `lib/protocol.ts` so it can be matched like the rest.

**Tests live in `tests/`, mirroring `src/`**, and everything they share is in `tests/support/`:
fixtures, the recording `CommandRunner`, the scoped `Bun.serve` harness, and `provided(layer)` —
the one `Effect.runPromise` a test performs, and the scope its temp directories, servers and
sockets are released by. `bun test` rules out `@effect/vitest`, so there is no `it.effect`;
`TestClock` comes from `effect` core when a test needs virtual time.

The control plane is reached through `@repo/api-client/internal`, and every call goes through it,
so a route the api does not mount is a compile error. What it cannot describe is the bytes that
come back, so `control/client.ts` still validates every response against `@repo/protocol` —
TypeBox, not `effect/Schema`, because the schemas are shared with the api.

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
- **No test builds the full layer graph**, so a service wired wrong in `index.ts` is caught by
  `tsc` and by starting the binary, not by `bun test`.
