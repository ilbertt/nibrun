# agent

The nibrun host agent. One compiled binary per app host: it opens a session with the control
plane, long-polls for desired state, converges the host onto it, and reports what it observes. It
is never sent a command. Read `lib/reconcile/`, `lib/volumes/topology.ts` and
`lib/network/slot.ts` first.

Besides converging, it answers directory reads through `lib/agent/filesystem.ts` and cron
listings through `lib/agent/cron-query.ts`, each on routes of its own.
Directory reads wake idle apps through `AppWaker` and hold `GuestActivity` through the wake
and listing; periodic filesystem measurements do neither.
`lib/agent/sqlite-query.ts` polls live SQLite operations on separate routes, bounds dispatched
queries, and admits session close while queries are executing. SQL is never retried by the agent. A read is not a state
anything converges on, so it carries no generation and cannot delay a stop. Cron listings read
the durable registry and cached desired state without waking a guest, including suspended apps.

**Never import `@repo/api` or any of its subpaths, including in tests.** Shared API–agent
message definitions come from `@repo/protocol`; agent mechanics and fallback policy stay here.
Tests use agent fixtures, not API defaults. Biome enforces this boundary.

Configured app volumes may use a separate NBD client through `AGENT_APP_VOLUME_NBD_CLIENT`.
It defaults to the packaged `nbd-client`. Private attachments use its ioctl mode in a separate
systemd scope, so the kernel's owner PID remains a live process across agent restarts.
An inherited per-device lock excludes overlapping setup, including before a PID is published.
Verification requires that PID's exact socket/export arguments and scope to match; saved slot
assignments and filesystem contents do not establish attachment ownership. Ioctl mode requires
an already-created NBD device and the host's unified cgroup hierarchy. Configured volumes allocate
only slots backed by an existing kernel device and block node; a missing device never moves an
existing assignment. Shared volumes and checkpoint readers retain their netlink path and slot
allocation behavior. No module reload is needed to discover usable devices on a running host.

Provisioning a present volume with explicit storage configuration starts its per-app ZeroFS
services and registers the ready filesystem. Shared-image conflicts, configuration changes and
foreign NBD attachments are rejected before startup. The control plane must grant exclusive
fleet ownership of each configured bucket/prefix. Unconfigured volumes never enter activation.
Pending configured-volume provisioning keeps reconciliation scheduled even without a guest to
start, so a transient storage failure does not require a new desired-state generation to recover.
Staged configuration directories also mark private storage after an agent restart; losing the
desired storage field must not redirect volume operations or VM starts to the shared backend.
Native checkpoints for configured volumes target only the matching registered app filesystem.
Their failures are sanitized; exports still require shared storage.
Configured checkpoint listings parse the pinned ZeroFS CLI's table and explicit empty response;
an unrecognized response refuses mutations. Shared checkpoint listing behavior stays unchanged.
Configured VM boots and wakes derive a runtime instance unit from the installed VM template,
binding only to their own ZeroFS server. Keep the VM unit name and service body unchanged, and
verify systemd's loaded fragment and dependencies before starting. Shared VMs use the template.

Explicit deletion flushes the image removal before stopping the app's services and unregistering
its filesystem. Retirement records reach disk before deletion is reported; they let retries avoid
reopening an already-retired bucket and prevent fallback to shared storage after a restart.
Cache and configuration files remain until acknowledged deletion allows local reclamation.
Reclamation verifies the stopped services and matching config before removing local files, then
releases their cache reservations. Durable retirement tombstones remain to reject stale starts.
Agent shutdown, guest sleep and an omitted desired volume never retire a writer.

Reserve per-app ZeroFS cache limits from every staged configuration, including while its guest
is idle or the filesystem registry is recovering after an agent restart. Memory reports and wake
admission use the same reservation; snapshot disk budgets reserve the per-app caches too. An
unreadable app reservation refuses new memory admission or snapshots. Staged reservations remain
until explicit lifecycle cleanup removes their configuration.

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

**Cron expressions are Bun's.** `lib/cron/schedule.ts` validates them and calculates the next
occurrence with `Bun.cron.parse`, explicitly in the protocol's `CRON_TIME_ZONE`.
`lib/cron/model.ts` owns registrations and persisted tables, deriving job fields from the
protocol's cron listing. Expression syntax stays in Bun rather than a second parser. Waiting and dispatch belong to scoped Effect fibers so cancellation, supervision
and `TestClock` work like the agent's other loops. Schedule calculation does not register a
timer or execute a tenant command.

`lib/cron/execution-client.ts` runs one registered command over a scoped connection to
the guest's port 51004. Its bounded NBR1 protocol matches `apps/runtime/src/guest-cron.h`.
The client acknowledges each output frame after its consumer accepts it and closes the
connection on interruption or consumer failure. It neither wakes a VM nor retries a run;
deployment ownership, wakeup and idle protection belong to its caller.

`lib/cron/execution-logs.ts` wraps that client with per-run stdout/stderr decoders and
publishes into the shared tenant log queue. Its caller supplies the job and run IDs before
dispatch. Queue refusal drops output without stalling a command; sequence gaps identify
missing records. Decoder remainders are flushed on completion, failure and interruption.

`GuestActivity` serializes idle capture against run admission and keeps each overlapping
run protected until completion. `CronExecutions` owns deployment scopes, wakes idle apps,
and drains old runs before reconcile replaces or suspends a VM. `CronScheduler` owns the
future timers: changing a crontab replaces timers while started commands finish in their
deployment scope. Its registry loop runs without waiting for a control-plane session;
Effect schedules wait on Bun-calculated UTC occurrences and never retry a command.

`SqliteSessions` owns read-only guest database streams through `lib/sqlite/` on port 51005.
Its Hrana v2 HTTP client relays complete pipelines, preserving integer and blob values and bounding request and response bodies. A stream holds
`GuestActivity` until it closes or has been idle for 30 seconds; reconciliation closes obsolete
deployment streams before stopping a VM. Requests serialize per socket, and no SQL operation
is replayed after a disconnect or uncertain result.

Cold boots pin kernel/rootfs paths to the immutable guest image adopted in the host bundle.
Before snapshotting, the agent checks the running Firecracker's root drive through `/vm/config`;
a symlink path, an older image or an unreadable configuration leaves the VM running. Image
identity never comes from resolving a running VM's drive symlink or from cached agent records.
Snapshots name the immutable rootfs path; legacy stamps and image changes force a cold boot.
Image adoption does not restart running guests.

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

Linux CI exercises the packaged NBD client's attach, repair, ownership rejection and detach
against an in-memory server and a real kernel device. The existing checks job installs its
packages and runs this test directly with `NIBRUN_TEST_NBD=1`; only the fixture's privileged
commands use sudo.
Linux CI also checks VM dependency isolation with real systemd and disposable sleep processes;
the fixture runs as root and refuses to replace any existing host units.
With `NIBRUN_TEST_ZEROFS_SYSTEMD=1`, Linux CI installs the unchanged per-app unit templates,
the pinned binary and a disposable `zerofs` account. A bind-mounted test directory stands in for
the data disk, with a fixture unit satisfying its dependency and a drop-in trusting the test CA.
Production activation and flush/stop helpers verify credential loading, unprivileged execution,
idempotent activation, unmount/runtime-directory cleanup and cache-free restart recovery. The
fixture refuses existing host paths, units or accounts and removes its own resources on exit.
The same test file also closes one agent topology scope and builds a fresh registry while the
real writer and mount keep running. Staged configuration rejects an omitted storage field,
and reactivation registers the existing filesystem without changing either PID or its data.
An unrelated unconfigured app still selects the shared filesystem.
This checks registry reconstruction, not a restart of the full agent binary or its layer graph.
With `NIBRUN_TEST_ZEROFS=1`, Linux CI also runs the pinned ZeroFS release against a disposable
RustFS bucket over TLS and a real FUSE mount. It stages the production app configuration, creates
the image through the volume file helpers, and writes through a real NBD attachment using the
production client service. After flushing and detaching, it removes the local cache and checks
the restored bytes through a fresh NBD attachment with direct I/O. The test requires a free
`/dev/nbd0`. Downloads use the checksum in
`infra/app-host/versions.json`; `NIBRUN_TEST_ZEROFS_BINARY` permits a preinstalled test binary.
The same fixture formats a seeded ext4 image through the production formatter, mounts it and
appends to a seeded file as an unprivileged owner. After unmounting, flushing and recovering
without the cache, it checks filesystem consistency, label, file contents, ownership and mode,
and verifies that the formatter does not format it again. These mounts contain only fixture data
on the disposable CI host; production never mounts a tenant ext4 filesystem on the host.
Configured checkpoint reconciliation also runs against real per-app and shared ZeroFS writers
on separate prefixes. It retries creation and deletion, verifies both survive cache-free writer
restarts, and checks that a same-named shared checkpoint remains intact.
The NBD persistence test opens a real read-only `--checkpoint` server with its own listeners
and cache, checks its bytes and write rejection, and keeps writing through the live NBD device
while that reader is open. After stopping both and clearing the writer cache, it reopens the
checkpoint with a fresh cache to verify the original bytes, then recovers the newer live bytes.

The gaps below still need a hypervisor, ZeroFS or real cloud storage; source inspection and
mocked tests do not establish those guarantees.

- **The nftables ruleset is rendered and asserted as text, never loaded.** Proving the isolation
  rules needs a booted guest trying to reach `169.254.169.254`, its neighbour and the control
  plane.
- **The Firecracker config is asserted as a structure, never booted.** Firecracker validates it
  with `deny_unknown_fields`, so a typo is a hard error at boot and nowhere earlier.
- **The configured image's full guest I/O path is not exercised.** Raw NBD writes now reach
  the real S3 backend and survive recovery, but a guest still needs to mount the image and read
  its filesystem after recovery.
- **AWS, other S3 providers and IMDS** remain untested against live services. The configured
  storage test uses RustFS. `ExportUploader` is the
  seam the export tests stand in front of, so what happens to a bundle's bytes after `writeBundle`
  is a recorded call and nothing more.
- **The guest freeze barrier remains untested.** The native test cuts a checkpoint after a
  completed NBD write without an extra admin flush and reads its captured bytes. It does not
  prove that an ext4 guest stays frozen until the checkpoint is recorded. Export tests assert
  freeze, cut, thaw and cleanup through recorded calls, without a real guest filesystem journal.
- **The installed checkpoint systemd unit has not been exercised.** Whether
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
