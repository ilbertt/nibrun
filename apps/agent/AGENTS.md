# agent

The nibrun host agent. One compiled binary per app host: it opens a session with the control
plane, long-polls for desired state, converges the host onto it, and reports what it observes.
It is never sent a command.

Compiles against `@repo/protocol` and nothing else. No third-party dependencies — Bun's
built-ins cover HTTP, S3, hashing, process spawning and file I/O, and that is what keeps the
binary small and its supply chain trivial. Everything the host does that Bun cannot do is a
subprocess: `systemctl`, `ip`, `nft`, `nbd-client`, `mkfs.ext4`, `mksquashfs`, `zerofs`.

## Modules, in dependency order

| Module | What it owns |
|---|---|
| `lib/` | exec, atomic JSON files, backoff, structured logging, the one-shape HTTP client |
| `control/` | the session, and the long-poll client that validates every message it receives |
| `reconcile/plan.ts` | the pure diff: desired vs observed → a plan. No I/O |
| `reconcile/reconciler.ts` | applies the plan, holds the bookkeeping, drives the health sweep |
| `volumes/` | which ZeroFS serves which prefix, device files, NBD attach/detach, the one-time `mkfs`, checkpoints |
| `vm/` | artifact cache, `instance.env`, the Firecracker config, the systemd template units |
| `network/` | the slot allocator, tap devices, the whole nftables ruleset |
| `health/` | the probe, and the reducer that decides `starting` vs `running` vs `failed` |
| `report/` | instance records, capacity, versions, the report, and the route projection |
| `aws/` | IMDSv2 credentials, because Bun's S3 client resolves static ones only |

## The decisions worth knowing before reading the code

**The agent does not own the VMs.** Each microVM is a systemd template instance,
`nibrun-vm@<instance-id>.service`, so Firecracker is a child of init. The agent is the
component that updates most often; if the VMs were its children, every agent restart would kill
every tenant app on the host. Restarting the agent is a non-event, and an operator inspects one
app with `systemctl status` and `journalctl -u nibrun-vm@<id>`.

**Restart policy lives in two layers and they do not overlap.** The *tenant process* is
restarted by the guest's init, with the budget in `RestartPolicy`; when it exhausts that budget
the guest powers itself off. The agent then sees the VM exit unasked, reports the instance
`failed`, and **does not boot it again** — deciding whether to try elsewhere is the reconciler's
call, and a host that retries forever hides a broken deploy. What the agent *does* retry is its
own staging failures (an S3 hiccup, a `mkfs` that failed), with exponential backoff read from
the same `RestartPolicy` numbers, up to `maxRestarts`. A new `deploymentId` resets the budget,
because that is the reconciler acting.

**A slot is one number per app.** Host port, tap device, guest /30 and NBD minor are all
derived from it, so there is exactly one thing to persist (`slots.json`) and no way for three of
the four to survive a restart while the fourth does not. The port is stable for the lifetime of
the app, which is what makes a redeploy invisible to the routing layer. A slot is released only
on an explicit volume `absent` — an instance merely missing from desired state is a stop, and
reusing its port would route one tenant's traffic into another tenant's VM.

**Instances are authoritative, volumes are not.** A microVM the control plane does not mention
is stopped and forgotten. A volume it does not mention is left exactly as it is; removal is only
ever an explicit `absent`, because a truncated response must not be able to delete a filesystem.
A volume marked `absent` while an instance still holds it is reported blocked and torn down on a
later pass, never mid-flight.

**The last desired state is cached on disk** (`desired-state.json`) and reconciled against
before the agent has even reached the control plane, so an agent restart during a control-plane
outage still converges.

**`cache_type: "Writeback"` on the data drive is mandatory.** Firecracker defaults a drive to
`Unsafe`, which discards flush requests: the guest's `fsync` returns success, ZeroFS is never
asked to flush, and the loss window stops being the flush interval and becomes unbounded.
Nothing observable goes wrong until a host dies.

**The host formats the tenant filesystem and never mounts it.** `mkfs.ext4` runs once at
provisioning; the only other thing the agent reads from the block device is two magic bytes to
tell a blank device from a provisioned one. Writing a filesystem is not parsing one, and the
export design depends on the kernel never parsing a tenant-controlled filesystem.

**One ZeroFS per host, and `storagePrefix` is checked rather than assumed.** A device file lives
*inside* a ZeroFS filesystem, and a ZeroFS filesystem is one `[storage] url` prefix — so how many
ZeroFS instances a host runs is a topology decision, not a deployment detail. v1 runs one, which
buys one process, one local cache and one S3 client per host and is the only shape whose cost
does not scale with tenant count. What it costs: the validated restore property — destroy a host,
point a new ZeroFS at the same prefix, get the data back byte-identically — is per *host* rather
than per *app*, and moving one app elsewhere is copying a device file between two filesystems
rather than repointing at a prefix.

The protocol already accommodates either shape because `storagePrefix` is on the volume; a
per-host prefix just means every volume on the host repeats it. Nothing in `volumes/` assumes one
filesystem — the mount path, the NBD socket and the admin RPC are all resolved *per volume* from
the prefix it names, so one ZeroFS per app is a second factory in `volumes/topology.ts` plus a
supervisor for the extra processes. A volume naming a prefix this host does not serve is reported
`failed`, never created here: writing it into the wrong filesystem would put a tenant's data
under a prefix nothing will ever look for it under, and no later reconcile undoes that.

**Exactly one read-write `zerofs run` per storage prefix, fleet-wide.** ZeroFS does not reject a
second writer — SlateDB's epoch fences the older one, which then dies on its next durable write,
after a window in which it has been acknowledging writes that will be silently discarded. A
duplicate is an outage, not an error message. The agent therefore never starts ZeroFS; systemd's
own single-instance guarantee is the lock.

**ZeroFS's lifecycle is not the agent's.** Restarting it tears down every NBD connection on the
host mid-request; the agent only ever calls its admin RPC (`flush`, checkpoints), and flushes
before every stop and detach because `ignore_fsync` makes the guest's own flushes a no-op. Worst
case loss is `flush_interval_secs` **plus** the seal and upload — budget 5–15 s at a 5 s interval,
not exactly 5. `CreateCheckpoint` takes the barrier itself, so no separate flush precedes it.

**The `zerofs` CLI is how the agent drives it**, over `[servers.rpc]` — `flush`, `checkpoint
create|list|delete`. The npm `zerofs-client` uses koffi native FFI and is unverified on Bun; it is
deliberately not used. Creating and sizing a device file has no RPC at all and is a plain
filesystem operation against the host's own mount of ZeroFS. That mount is **not** the tenant's
ext4: the host writes a sparse *file* into ZeroFS's filesystem and never asks its kernel to
interpret what that file contains, so the rule that the kernel never parses tenant-controlled
filesystem metadata is intact. It looks like a violation and is not — `volumes/topology.ts` says
so at the field it applies to.

**`PORT` in `instance.env` comes from the declared guest port**, and a tenant value for it is
dropped — it is the number the host forwards to. A value containing a newline has no
representation in a format with no quoting, so it fails the instance rather than silently
truncating configuration into the next line.

**Log shipping is not built and must not reuse the control channel.** A log burst must never be
able to delay a stop.

## What this component needs from `infra/app-host/`

Not owned here. Written down so the change that owns it can implement exactly this.

### `nibrun-vm@.service` — already written, and it matches

- `%i` is the `InstanceId` verbatim. Instance ids are `[0-9A-Za-z][0-9A-Za-z_-]{0,62}`, none of
  which systemd escapes, so the unit name round-trips.
- The unit reads **only** `/var/lib/nibrun/vm/%i/firecracker.json`. The agent writes that file,
  the per-instance `config.squashfs` beside it, and the tap device, before calling
  `systemctl start`. Nothing is passed on the command line and no environment is required.
- The agent reaches it with `systemctl start|stop|show|list-units|reset-failed`, and needs
  `Restart=no` to stay: if systemd restarted the VM, the agent could never report `failed` and
  an app broken at boot would loop forever unobserved.
- Firecracker's stdout is the guest console, so `journalctl -u nibrun-vm@<id>` is the tenant's
  own output, for free.
- If the jailer is adopted later, every path in `firecracker.json` becomes jail-relative and the
  agent must stage into `<chroot>/root/`. That is a change to that unit *and* to `vm/manager.ts`
  — it is not a drop-in.

**One disagreement to settle.** The unit carries `BindsTo=nibrun-zerofs.service`, which stops
every tenant VM on the host whenever ZeroFS restarts. The measured behaviour is milder than that
implies: `nbd-client -persist` reconnects on its own, and with `-timeout 600` a ZeroFS restart is
a *stall* in the guest, not an I/O error — the guest's ext4 only remounts read-only if the
restart outlasts the timeout. `BindsTo` converts a recoverable stall into a fleet-wide outage,
and kills VMs mid-write rather than at a durability point. The agent behaves correctly either
way; this is a blast-radius decision that belongs to whoever owns the unit.

### Still missing: a mount of the ZeroFS filesystem

`[servers.ninep]` is configured but nothing mounts it, and an app's disk is a sparse file the
agent creates at `<mount>/.nbd/<volume-id>`. Volume provisioning fails at the first step without
one. Needed: a unit that mounts the 9P socket (`zerofs mount`, FUSE) at `AGENT_ZEROFS_MOUNT`,
ordered after `nibrun-zerofs.service` and before `nibrun-agent.service`. The RPC admin service
cannot create files, so there is no way to do this over the socket the agent already uses.

### Filesystem

| Path | Owner | Contents |
|---|---|---|
| `/var/lib/nibrun/` | agent, mode 0700 | `host-id`, `slots.json`, `instances.json`, `desired-state.json`, `artifacts/<digest>/`, `vm/<instance-id>/` |
| `/var/lib/nibrun/bootstrap-token` | provisioning, mode 0600 | the bootstrap credential, delivered via instance user-data |
| `/run/nibrun/vm-<instance-id>.sock` | the unit | Firecracker API socket. The agent does not use it — the VM is configured entirely by `--config-file` |
| `/opt/nibrun/bin/guest-image/` | deploy | `vmlinux`, `rootfs.ext4` |
| `/opt/nibrun/bin/firecracker/` | deploy | `firecracker` |
| `/etc/nibrun/agent.env` | deploy, mode 0600 | the agent unit's `EnvironmentFile` |
| `/opt/nibrun/bundle/versions.json` | CI | `{ agent, guestImage, zerofs, firecracker }`, four version **strings** — validated against `HostVersionsSchema`; a missing or differently-shaped file is a hard startup failure. `infra/app-host/versions.json` is a richer object (urls, digests) and is **not** this file |
| `/mnt/zerofs/` | a ZeroFS FUSE or NFS mount unit | the agent creates `.nbd/<volume-id>` in here |
| `/run/zerofs/nbd.sock` | zerofs.service | NBD |
| `/etc/zerofs/config.toml` | deploy | passed to every `zerofs` admin call |

### Host packages and kernel state — none of this is provisioned yet

`iproute2`, `nftables`, `nbd-client`, `e2fsprogs` (`mkfs.ext4`), `squashfs-tools` (`mksquashfs`).
Nothing in `infra/` installs them today, and each one is a subprocess the agent shells out to.

```
modprobe nbd nbds_max=256        # the default of 16 caps the host at 16 apps
sysctl net.ipv4.ip_forward=1
```

The base `FORWARD` policy must be `ACCEPT`. The agent owns `table ip nibrun` and expresses
isolation as `drop` rules, which are final wherever they appear; its `accept` rules only end its
own chain, so it composes with a coexisting ruleset but cannot open one that is closed.

### Agent environment

Required: `AGENT_CONTROL_PLANE_URL`, `AGENT_ARTIFACT_BUCKET`, `AGENT_AWS_REGION`,
`AGENT_ZEROFS_STORAGE_PREFIX` — the `[storage] url` prefix this host's ZeroFS is pointed at, and
the value the control plane must put on every volume it places here. It has to match what
`/etc/zerofs/config.toml` names, or every volume is refused.

Optional, with the defaults in `src/config.ts`: `AGENT_STATE_DIR`, `AGENT_RUNTIME_DIR`,
`AGENT_BOOTSTRAP_TOKEN_FILE`, `AGENT_VERSIONS_FILE`, `AGENT_GUEST_IMAGE_DIR`,
`AGENT_FIRECRACKER_DIR`, `AGENT_ZEROFS_MOUNT`, `AGENT_ZEROFS_CONFIG_FILE`,
`AGENT_ZEROFS_NBD_SOCKET`, `AGENT_LOG_LEVEL`, `AGENT_CONTROL_PLANE_CIDRS`,
`AGENT_GUEST_DNS_SERVERS`.

The agent's own unit needs `CAP_NET_ADMIN` (tap devices, nftables) and root or equivalent for
`nbd-client` and `mkfs.ext4`. It must **not** be `Restart=no`: an agent that dies should come
back, and coming back is safe by construction.

### One thing `apps/runtime` should know

Guests are denied every RFC1918, CGNAT and link-local destination, so the **VPC resolver is not
reachable** from a guest under the default ruleset. Either `/init` writes a public resolver into
`/run/resolv.conf`, or the operator names the VPC resolver in `AGENT_GUEST_DNS_SERVERS`, which
renders an explicit accept for it ahead of the blanket drop.

## What is not tested, and what it would take

Everything that needs a hypervisor, a Linux kernel or AWS is untested — this was written on
macOS with no AWS credentials. Specifically:

- **The nftables ruleset is rendered and asserted as text, never loaded.** `nft -c -f -` on a
  Linux host would check the syntax; proving the isolation rules needs a booted guest trying to
  reach `169.254.169.254`, its neighbour and the control plane.
- **The Firecracker config is asserted as a structure, never booted.** Firecracker validates it
  with `deny_unknown_fields`, so a typo is a hard error at boot and nowhere earlier.
- **NBD attach, `mkfs.ext4`, `mksquashfs`, `systemctl` and `zerofs` are all subprocesses whose
  invocations are asserted nowhere.** In particular nothing has confirmed that a `truncate` onto
  a `zerofs mount` produces a device file ZeroFS then exports, which is the single step the whole
  volume path rests on. The parsers for their *output* are tested against captured
  formats; the argument lists are not.
- **S3 and IMDS.** The credential provider is tested against a stub; nothing has spoken to AWS.
- The Firecracker drive-on-`/dev/nbdN` path is upstream-undocumented — mechanically sound, never
  run here.
