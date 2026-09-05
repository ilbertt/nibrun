# agent

The nibrun host agent. One compiled binary per app host: it opens a session with the control
plane, long-polls for desired state, converges the host onto it, and reports what it observes. It
is never sent a command. Read `lib/reconcile/`, `lib/volumes/topology.ts` and
`lib/network/slot.ts` first.

It answers one kind of question besides converging: `lib/agent/filesystem.ts` polls for a
directory read and answers it, on routes of its own. A read is not a state anything converges on,
so it carries no generation and cannot delay a stop.

**Written in Effect.** Every effectful path is an `Effect` with a typed error channel; anything a
test needs to substitute is a service. State that used to be
mutable class fields lives in a `Ref`. The loops in `lib/agent/` are fibers, and their retry
cadence is a `Schedule` rather than a failure counter. Interruption is the shutdown path:
`BunRuntime.runMain` cancels the fibers and scoped finalizers close the log sockets. Nothing stops
a tenant VM, which is what keeps redeploying the agent free.

**A service is an `Effect.Service`, and there is no second way to define one.** `Context.Tag` with
a hand-written `Layer` is the primitive underneath it, not an alternative style: reaching for it
gives a service that is provided as `layer` while its neighbours are provided as `Default`, and
that inconsistency spreads to whatever is written next to it. A test substitutes a service through
the generated `make` — `Layer.succeed(CommandRunner, CommandRunner.make({ run }))`. If something
does not deserve a service, it is plain functions taking what they need from context, as
`lib/vm/systemd.ts` is.

**Every service lives in `services/`, one per file**, named for the service it exports — the
kebab-case of the identifier plus `.service.ts`, so `VolumeManager` is
`volume-manager.service.ts`. A `.service.ts` module holds the service and nothing
else; pure functions, error classes and host mechanics stay in the domain folder they belong to.
`apps/api/src/services/` is the same shape, so the two apps read the same way.

**`src` is three things**: `index.ts` composes the layer graph, `services/` holds the services,
and `lib/` holds everything else grouped by domain — `lib/reconcile/`, `lib/volumes/`,
`lib/network/` and the rest, alongside the loose modules every domain uses. `tests/` mirrors it.

**Every service names its own requirements** in `dependencies`, so `index.ts` is a flat merge whose
order carries nothing. A test that hands one of them a stub config takes
`DefaultWithoutDependencies`: `Default` has already been given `AgentConfig.Default`, so a config
provided from outside is ignored without a word, and the real one then fails at runtime on an
environment the test never set.

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
come back, so `lib/control/client.ts` still validates every response against `@repo/protocol` —
TypeBox, not `effect/Schema`, because the schemas are shared with the api.

## What the host must provide, and does not yet

Owned by `infra/app-host/`, not fixable here.

- **A mount of the ZeroFS filesystem.** `[servers.ninep]` is configured and nothing mounts it, so
  volume provisioning fails at its first step. The admin RPC cannot create files, so there is no
  way to do this over the socket the agent already uses.
- **`iproute2`, `nftables`, `nbd-client`, `e2fsprogs`, `squashfs-tools`.** Each is a subprocess the
  agent shells out to, and nothing installs any of them.
- **A base `FORWARD` policy of `ACCEPT`.** The agent owns `table ip nibrun` and expresses isolation
  as `reject` rules, which are final wherever they appear; its `accept` rules only end its own
  chain, so it composes with a coexisting ruleset but cannot open one that is closed. The other
  half of a guest reaching the internet, `net.ipv4.ip_forward=1`, *is* provided — by
  `infra/app-host/deploy/on_box_deploy.sh`, and without it the kernel discards a guest's packets
  before any of these rules is consulted.
- **A tracer.** The agent names its spans — every reconcile phase, subprocess and control-plane
  request — and nothing collects them, so they go nowhere. Where they are exported to is a
  deployment decision, not one the binary should hold.

## What is not tested

Everything that needs a hypervisor, a Linux kernel or AWS — this was written on macOS with no AWS
credentials, and the gap is wider than the test count suggests.

- **The nftables ruleset is rendered and asserted as text, never loaded.** Proving the isolation
  rules needs a booted guest trying to reach `169.254.169.254`, its neighbour and the control
  plane.
- **The Firecracker config is asserted as a structure, never booted.** Firecracker validates it
  with `deny_unknown_fields`, so a typo is a hard error at boot and nowhere earlier.
- **Almost every subprocess argument list is unasserted** — only the parsers for their *output*
  are tested, and the export path, where the order the commands come in is the guarantee. In
  particular nothing has confirmed that a `truncate` onto a `zerofs` mount produces a device file
  ZeroFS then exports, which is the one step the whole volume path rests on.
- **`mkfs.ext4 -d` has never written a seeded filesystem onto a real device.** The unpack is
  exercised against a temp directory — every refusal, both ceilings, and who the tree ends up
  belonging to — but who it belongs to is only provable as "whoever the caller said", because only
  root may give a file away and none of this was run as root. That the tenant can then write to
  their own `data/`, and that mke2fs is content with a tree behind an NBD device, are a host's
  questions.
- **S3 and IMDS** are tested against stubs; nothing has spoken to AWS. `ExportUploader` is the
  seam the export tests stand in front of, so what happens to a bundle's bytes after `writeBundle`
  is a recorded call and nothing more.
- **No checkpoint has been cut.** The export is asserted as a sequence of invocations against a
  recording runner: the cut happens while the guest is frozen, the read after it has thawed, and
  the checkpoint, its server and its device go on every way out. That ZeroFS answers `checkpoint
  create` by sealing the open segment and flushing metadata *before* it records — which is why the
  export no longer flushes first, and under `ignore_fsync` is the whole durability guarantee — is
  read from ZeroFS v2.3.1's source rather than observed here. A version bump has to re-read it.
- **The read-only checkpoint server has never been started.** Whether
  `nibrun-zerofs-checkpoint@.service` and `checkpoint.toml` between them produce a listening NBD
  socket — the `%i` expansion, the `ExecStartPost` wait, ZeroFS's own `${VAR}` substitution — is a
  question only a host can answer.
- **A lost freeze is noticed by asking whether the connection is still open**, which trails the
  guest hanging up by an event-loop turn. The export test makes its fake `checkpoint create` take
  time for that reason, and a real one takes far longer, but a guest that thawed within
  microseconds of the cut being recorded would get past this.
- The Firecracker drive-on-`/dev/nbdN` path is upstream-undocumented — mechanically sound, never
  run here.
- **No microVM has been slept or woken.** The API client is asserted against a listening unix
  socket, so the request shapes are the ones 1.16.1's swagger describes; that Firecracker accepts
  them, that a bare process restores a guest whose NBD drive was reattached under it, and that
  `vm_launch.sh` picks the right mode under systemd are all questions only a host can answer. The
  disk bound a sleep is refused by is arithmetic here; what `statfs` reports for a real `/data`,
  and whether ZeroFS reads its own `disk_size_gb` as GiB or GB, are not.
- **No test builds the full layer graph**, so a service wired wrong in `index.ts` is caught by
  `tsc` and by starting the binary, not by `bun test`.
