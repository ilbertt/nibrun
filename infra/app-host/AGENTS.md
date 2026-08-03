# infra/app-host

What lands on an app host once `infra/terraform/app_host.tf` has built the machine. Nothing is
containerised: the agent manipulates host networking and spawns microVMs, so a container would
hand back every privilege it removed.

## Invariants a change here must keep

- **Re-running a deploy on a healthy host changes nothing**, and a new host reaches a working
  state with nobody connecting to it. Every restart is conditional on something having actually
  moved, so a step that runs unconditionally breaks the first half.
- **A version is chosen only in `versions.json`.** Nothing may ask S3 what the newest one is — see
  `packages/internal-scripts/src/shared/app-host-versions.ts`.
- **Exactly one read-write `zerofs run` per storage prefix, fleet-wide.** ZeroFS does not reject a
  second one: SlateDB's writer epoch fences the older process, which then dies on its next durable
  write, after a window in which it has been acknowledging writes that are silently discarded. A
  duplicate is an outage rather than an error message, and systemd's single-instance guarantee is
  the only lock there is.

## Unsettled

**`nibrun-vm@.service` carries `BindsTo=nibrun-zerofs.service`**, which stops every tenant VM on
the host whenever ZeroFS restarts. Measured behaviour is milder than that implies: `nbd-client
-persist` reconnects on its own, and with a long timeout a ZeroFS restart is a *stall* in the guest
rather than an I/O error — the guest's ext4 only remounts read-only if the restart outlasts the
timeout. So `BindsTo` converts a recoverable stall into a fleet-wide outage, and kills VMs
mid-write rather than at a durability point. The agent behaves correctly either way; this is a
blast-radius decision nobody has made.

**Nothing mounts `[servers.ninep]`.** An app's disk is a sparse file the agent creates inside the
ZeroFS filesystem, so volume provisioning cannot work until a unit mounts that socket where the
agent looks for it, ordered after `nibrun-zerofs.service` and before `nibrun-agent.service`.
