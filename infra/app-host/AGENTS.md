# infra/app-host

Everything an app host runs. The machine itself is `infra/terraform/app_host.tf`; this is what
lands on it.

Nothing here is containerised and Docker is not installed — the agent manipulates host
networking and spawns microVMs, so a container would hand back every privilege it removed.

```
/opt/nibrun/
  versions/<component>/<version>/…   every version fetched, until pruned
  bin/<component> -> versions/…      the active one; what the units resolve
  bundle/                            what CI ships: units, versions.json, the ZeroFS config, the deploy script
/var/lib/nibrun/                     agent state, artifact cache, per-VM directories
/data/                               the EBS volume — ZeroFS's local cache, and nothing else
```

A version directory counts as present only once it holds a `.installed` marker, so an
interrupted download is retried rather than adopted as finished.

## versions.json is the only place a version is chosen

CI reads it and **never asks S3 what the newest version is** — that is what makes "what is this
host running" answerable from git rather than from whichever job ran last. The agent is the one
exception: its version is the git SHA, and every push ships a new one.

A build **publishes** a version without adopting it. Adopting is a separate commit editing this
file, and that commit is the reviewable artifact. `guestImage` is `null` until the first image
is adopted; a host deploys fine without one and simply cannot boot microVMs, which is correct
before any tenant app exists.

## What a deploy restarts, and what it must not

Only the units whose resolved version — or whose configuration — actually moved.

- **Agent bumped**, the common case: restarts `nibrun-agent`. **No tenant VM restarts.** They
  are systemd units in their own right, so it comes back and reconciles against what it finds.
- **Guest image or Firecracker bumped**: nothing restarts. Running VMs keep what they booted
  with; the new one reaches an app when it is next redeployed.
- **ZeroFS bumped — disruptive.** It serves the NBD device behind every guest disk on the host,
  so restarting it stalls every app at once and an attached guest may remount read-only. Bump
  it in its own commit, deliberately, expecting impact — never riding along with a feature push.
- **Nothing bumped**: nothing downloads, no symlink moves, nothing restarts.

Re-running a deploy on a healthy host must change nothing, and a new host must reach a working
state with nobody connecting to it.

## Two that will bite

Exactly one read-write `zerofs run` may exist per storage prefix, **fleet-wide**. ZeroFS does
not reject a second one — the fence is SlateDB's writer epoch and the loser exits, so a
duplicate is an outage rather than an error message.

Guest kernel 6.1's minimum end of support is 2026-09-02. Plan the bump.
