import type {
  AppId,
  DesiredInstance,
  DesiredVolume,
  HostDesiredState,
  InstanceId,
  ObjectKey,
  ReportedCheckpoint,
  ReportedVolume,
  VolumeId,
} from '@repo/protocol';
import type { AgentConfig } from '#config.ts';
import { probeInstance } from '#health/probe.ts';
import { applyProbe, evaluateInstanceState, initialTracker } from '#health/state.ts';
import { isReadyToRetry, nextAttemptWindow } from '#lib/backoff.ts';
import { nowTimestamp } from '#lib/clock.ts';
import type { CommandRunner } from '#lib/exec.ts';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { describeError, logger } from '#lib/logger.ts';
import type { SlotAllocator } from '#network/allocator.ts';
import type { ForwardedInstance } from '#network/firewall.ts';
import { applyRuleset } from '#network/nftables.ts';
import type { CaddyProxy } from '#proxy/caddy.ts';
import {
  type CheckpointPlan,
  type ObservedState,
  planReconcile,
  type ReconcilePlan,
} from '#reconcile/plan.ts';
import {
  type InstanceRecord,
  newInstanceRecord,
  readInstanceRecords,
} from '#report/instance-record.ts';
import { type RouteTarget, renderableRoutes } from '#report/routes.ts';
import type { VmManager } from '#vm/manager.ts';
import type { SystemdVmUnits, UnitStatus } from '#vm/systemd.ts';
import type { VolumeManager } from '#volumes/manager.ts';
import type { ZerofsTopology } from '#volumes/topology.ts';
import type { ZerofsAdmin } from '#volumes/zerofs.ts';

const NO_GENERATION = 0;
const ONE_RESTART = 1;
const MAX_MESSAGE_LENGTH = 512;

const UNKNOWN_UNIT: UnitStatus = {
  loaded: false,
  active: false,
  failed: false,
  startedThisBoot: false,
};

export type ReconcilerOptions = {
  config: AgentConfig;
  runner: CommandRunner;
  units: SystemdVmUnits;
  vms: VmManager;
  volumes: VolumeManager;
  topology: ZerofsTopology;
  allocator: SlotAllocator;
  proxy: CaddyProxy;
};

/**
 * Pull, converge, report.
 *
 * Nothing here is driven by a command. Desired state describes a world, this compares it with
 * what the host is observed to be doing, and the difference is the work — which is why an
 * agent restart, a control-plane restart and a missed message are all non-events.
 */
export class Reconciler {
  readonly #options: ReconcilerOptions;
  readonly #records = new Map<InstanceId, InstanceRecord>();
  readonly #unitStatus = new Map<InstanceId, UnitStatus>();
  readonly #nextProbeAtMs = new Map<InstanceId, number>();
  readonly #allocator: SlotAllocator;
  #volumeReports: ReportedVolume[] = [];
  #checkpointReports: ReportedCheckpoint[] = [];
  #observedGeneration = NO_GENERATION;
  #converged = false;

  constructor(options: ReconcilerOptions) {
    this.#options = options;
    this.#allocator = options.allocator;
  }

  get observedGeneration() {
    return this.#observedGeneration;
  }

  get converged() {
    return this.#converged;
  }

  records(): InstanceRecord[] {
    return [...this.#records.values()];
  }

  volumeReports(): ReportedVolume[] {
    return this.#volumeReports;
  }

  checkpointReports(): ReportedCheckpoint[] {
    return this.#checkpointReports;
  }

  // What the local user-app proxy renders its config from — the same records the boot path
  // writes, rather than a second copy of them.
  routes(): RouteTarget[] {
    return renderableRoutes(this.records());
  }

  async load(): Promise<void> {
    for (const record of readInstanceRecords(
      await readJsonFile({ path: this.#options.config.instancesFile }),
    )) {
      this.#records.set(record.instanceId, record);
    }
    logger.info({
      message: 'agent state loaded',
      instances: this.#records.size,
      slots: this.#allocator.slots().length,
    });
  }

  /**
   * What is really running, asked of systemd rather than remembered.
   *
   * The union of the units systemd knows about and the instances this agent has notes on is
   * deliberate: a unit with no note is an orphan to stop, and a note with no unit is an
   * instance that is gone. Trusting only the notes is what would make a restarted agent
   * confidently wrong.
   */
  async observe(): Promise<ObservedState> {
    const unitIds = await this.#options.units.listInstanceIds();
    const ids = [...new Set([...unitIds, ...this.#records.keys()])];
    const statuses = await this.#options.units.statuses(ids);
    this.#unitStatus.clear();
    for (const [instanceId, status] of statuses) {
      this.#unitStatus.set(instanceId, status);
    }

    const instances = ids.map((instanceId) => {
      const status = statuses.get(instanceId) ?? UNKNOWN_UNIT;
      const record = this.#records.get(instanceId);
      return {
        instanceId,
        ...(record ? { appId: record.appId, volumeId: record.volumeId } : {}),
        ...(record ? { deploymentId: record.deploymentId } : {}),
        present: status.loaded || record !== undefined,
        running: status.active,
        // `startedThisBoot` is what keeps a reboot out of this. The record survives on disk, so
        // after a reboot every instance still looks like one this agent started and nobody asked
        // to stop — which read as `exited`, and an exited instance is deliberately left alone.
        // The host would come back with its VMs down and nothing to bring them up.
        exited:
          !status.active &&
          status.startedThisBoot &&
          record?.startedAt !== undefined &&
          !record.stopRequested,
      };
    });

    return {
      instances,
      volumes: await this.#options.volumes.observe({ appIdByVolume: this.#appIdByVolume() }),
      // Listing checkpoints costs an RPC round trip on every reconcile, and almost every
      // reconcile has none to converge. The list is read once, inside the branch that needs it.
      checkpoints: [],
    };
  }

  async reconcile({ desired }: { desired: HostDesiredState }): Promise<void> {
    const observed = await this.observe();
    const plan = planReconcile({ desired, observed });
    this.#syncDesired(desired);

    await this.#applyStops(plan);
    await this.#applyVolumes(plan);
    await this.#applyStarts(plan);
    await this.#applyCheckpoints({ plan, desired });
    await this.#applyTeardowns(plan);
    await this.#applyNetwork();
    await this.#applyRoutes();
    await this.#persist();

    this.#observedGeneration = desired.generation;
    this.#converged = true;
  }

  /**
   * Probes the tenants that are due, then re-reads what systemd says and settles every
   * instance's state from the two together.
   */
  async refreshStates(): Promise<void> {
    const ids = [...this.#records.keys()];
    const statuses = await this.#options.units.statuses(ids);
    const nowMs = Date.now();

    for (const record of this.#records.values()) {
      const status = statuses.get(record.instanceId) ?? UNKNOWN_UNIT;
      this.#unitStatus.set(record.instanceId, status);
      if (status.active && this.#isProbeDue({ instanceId: record.instanceId, nowMs })) {
        const healthy = await probeInstance({
          guestIpv4: record.guestIpv4,
          guestPort: record.guestPort,
          healthCheck: record.healthCheck,
        });
        record.health = applyProbe({
          tracker: record.health,
          healthy,
          at: nowTimestamp(),
          healthyThreshold: record.healthCheck.healthyThreshold,
        });
        this.#nextProbeAtMs.set(record.instanceId, nowMs + record.healthCheck.intervalMs);
      }
      const previous = record.state;
      record.state = evaluateInstanceState({
        unit: status,
        tracker: record.health,
        healthCheck: record.healthCheck,
        desiredRunning: record.desiredRunning,
        stopRequested: record.stopRequested,
        ...(record.startedAt ? { startedAtMs: Date.parse(record.startedAt) } : {}),
        nowMs,
      });
      if (record.state !== previous) {
        logger.info({
          message: 'instance state changed',
          instanceId: record.instanceId,
          from: previous,
          to: record.state,
        });
        if (status.exitCode !== undefined && !status.active) {
          record.lastExitCode = status.exitCode;
        }
      }
    }
    // An instance becomes routable here rather than in reconcile: the probe is what tells a
    // booted VM from one whose tenant has answered, and that is the whole distinction routing
    // rests on.
    await this.#applyRoutes();
    await this.#persist();
  }

  // Hostnames, the health check and whether the app should be up can all change without the
  // artifact changing. Folding them into the record here is what keeps the route renderer and
  // the probe reading current configuration rather than whatever was true at boot.
  #syncDesired(desired: HostDesiredState): void {
    for (const wanted of desired.instances) {
      const record = this.#records.get(wanted.instanceId);
      if (!record) {
        continue;
      }
      record.hostnames = wanted.hostnames;
      record.healthCheck = wanted.config.healthCheck;
      record.resources = wanted.config.resources;
      record.desiredRunning = wanted.desiredState === 'running';
      record.guestPort = wanted.config.guestPort;
    }
  }

  #isProbeDue({ instanceId, nowMs }: { instanceId: InstanceId; nowMs: number }) {
    return nowMs >= (this.#nextProbeAtMs.get(instanceId) ?? 0);
  }

  #appIdByVolume(): Map<VolumeId, AppId> {
    return new Map(
      [...this.#records.values()].map((record) => [record.volumeId, record.appId] as const),
    );
  }

  async #applyStops(plan: ReconcilePlan): Promise<void> {
    for (const action of plan.instances) {
      if (action.action === 'stop') {
        await this.#stop({ instanceId: action.instanceId, reason: action.reason });
      }
      if (action.action === 'replace') {
        await this.#stop({ instanceId: action.desired.instanceId, reason: 'superseded' });
        await this.#options.vms.discard({ instanceId: action.desired.instanceId });
        this.#records.delete(action.desired.instanceId);
      }
      if (action.action === 'forget') {
        await this.#options.vms.discard({ instanceId: action.instanceId });
        this.#records.delete(action.instanceId);
      }
    }
  }

  async #stop({ instanceId, reason }: { instanceId: InstanceId; reason: string }): Promise<void> {
    const record = this.#records.get(instanceId);
    if (record) {
      record.stopRequested = true;
      record.state = 'stopping';
    }
    // Under `ignore_fsync` the guest's own flushes are a no-op, so this is the only thing
    // standing between a stop and the loss of everything since the last periodic flush. Worst
    // case is the flush interval *plus* the seal and upload, not exactly the interval.
    await this.#tryFlush();
    try {
      await this.#options.vms.stop({ instanceId });
      logger.info({ message: 'instance stopped', instanceId, reason });
    } catch (error) {
      logger.error({
        message: 'instance stop failed',
        instanceId,
        reason,
        ...describeError(error),
      });
    }
    if (record) {
      record.state = 'stopped';
    }
  }

  async #applyVolumes(plan: ReconcilePlan): Promise<void> {
    const reports: ReportedVolume[] = [];
    for (const action of plan.volumes) {
      if (action.action === 'provision') {
        reports.push(await this.#provision(action.desired));
      }
      if (action.action === 'blocked') {
        logger.warn({
          message: 'volume removal deferred: still attached',
          volumeId: action.desired.volumeId,
          blockedBy: action.blockedBy,
        });
      }
    }
    this.#volumeReports = mergeVolumeReports({ existing: this.#volumeReports, updates: reports });
  }

  async #provision(desired: DesiredVolume): Promise<ReportedVolume> {
    try {
      return await this.#options.volumes.provision({ desired });
    } catch (error) {
      logger.error({
        message: 'volume provisioning failed',
        volumeId: desired.volumeId,
        ...describeError(error),
      });
      return {
        volumeId: desired.volumeId,
        state: 'failed',
        sizeBytes: desired.sizeBytes,
        message: truncate(describeError(error).error),
      };
    }
  }

  async #applyTeardowns(plan: ReconcilePlan): Promise<void> {
    for (const action of plan.volumes) {
      if (action.action !== 'teardown') {
        continue;
      }
      try {
        const report = await this.#options.volumes.teardown({ desired: action.desired });
        this.#volumeReports = mergeVolumeReports({
          existing: this.#volumeReports,
          updates: [report],
        });
      } catch (error) {
        logger.error({
          message: 'volume teardown failed',
          volumeId: action.desired.volumeId,
          ...describeError(error),
        });
      }
    }
  }

  async #applyStarts(plan: ReconcilePlan): Promise<void> {
    for (const action of plan.instances) {
      if (action.action !== 'start' && action.action !== 'replace') {
        continue;
      }
      await this.#start({ desired: action.desired });
    }
  }

  async #start({ desired }: { desired: DesiredInstance }): Promise<void> {
    const nowMs = Date.now();
    const existing = this.#records.get(desired.instanceId);
    const policy = desired.config.restartPolicy;
    if (existing && existing.startAttempts.attempts > policy.maxRestarts) {
      return;
    }
    if (existing && !isReadyToRetry({ window: existing.startAttempts, nowMs, policy })) {
      return;
    }

    const slot = this.#allocator.allocate(desired.appId);
    const record =
      existing ??
      newInstanceRecord({
        instanceId: desired.instanceId,
        appId: desired.appId,
        deploymentId: desired.deploymentId,
        volumeId: desired.volumeId,
        hostnames: desired.hostnames,
        hostPort: slot.hostPort,
        guestPort: desired.config.guestPort,
        guestIpv4: slot.guestIpv4,
        artifactDigest: desired.artifact.digest,
        state: 'pending',
        health: initialTracker(),
        healthCheck: desired.config.healthCheck,
        resources: desired.config.resources,
        desiredRunning: true,
      });
    record.startAttempts = nextAttemptWindow({
      window: record.startAttempts,
      nowMs,
      resetAfterMs: policy.resetAfterMs,
    });
    this.#records.set(desired.instanceId, record);

    try {
      await this.#options.vms.boot({
        desired,
        slot,
        dataDevicePath: slot.nbdDevicePath,
      });
      record.startedAt = nowTimestamp();
      record.state = 'starting';
      record.stopRequested = false;
      record.health = initialTracker();
      record.restartCount += existing ? ONE_RESTART : 0;
      delete record.message;
      this.#nextProbeAtMs.delete(desired.instanceId);
      logger.info({
        message: 'instance started',
        instanceId: desired.instanceId,
        hostPort: record.hostPort,
        guestIpv4: record.guestIpv4,
      });
    } catch (error) {
      record.state = 'failed';
      record.message = truncate(describeError(error).error);
      logger.error({
        message: 'instance start failed',
        instanceId: desired.instanceId,
        attempt: record.startAttempts.attempts,
        ...describeError(error),
      });
    }
  }

  /**
   * `CreateCheckpoint` takes the flush barrier itself before capturing the manifest, so there
   * is no separate flush here — an extra one would be a redundant round trip against a
   * guarantee the RPC already makes.
   */
  async #applyCheckpoints({
    plan,
    desired,
  }: {
    plan: ReconcilePlan;
    desired: HostDesiredState;
  }): Promise<void> {
    if (desired.checkpoints.length === 0) {
      this.#checkpointReports = [];
      return;
    }
    const reports: ReportedCheckpoint[] = [];
    for (const action of plan.checkpoints) {
      if (action.action === 'none') {
        continue;
      }
      reports.push(await this.#applyCheckpoint(action));
    }
    this.#checkpointReports = reports;
  }

  async #applyCheckpoint(
    action: Extract<CheckpointPlan, { action: 'create' | 'delete' }>,
  ): Promise<ReportedCheckpoint> {
    const { checkpointId, volumeId } = action.desired;
    try {
      const admin = this.#adminFor();
      const existing = new Set(await admin.listCheckpoints());
      if (action.action === 'create' && !existing.has(checkpointId)) {
        await admin.createCheckpoint({ checkpointId });
      }
      if (action.action === 'delete' && existing.has(checkpointId)) {
        await admin.deleteCheckpoint({ checkpointId });
      }
      return action.action === 'create'
        ? {
            checkpointId,
            volumeId,
            state: 'ready',
            reference: checkpointId,
            readyAt: nowTimestamp(),
          }
        : { checkpointId, volumeId, state: 'pending' };
    } catch (error) {
      return {
        checkpointId,
        volumeId,
        state: 'failed',
        message: truncate(describeError(error).error),
      };
    }
  }

  #adminFor(): ZerofsAdmin {
    return this.#options.topology.place().admin;
  }

  async #tryFlush(): Promise<void> {
    for (const filesystem of this.#options.topology.all()) {
      try {
        await filesystem.admin.flush();
      } catch (error) {
        logger.warn({
          message: 'zerofs flush failed',
          storagePrefix: filesystem.storagePrefix,
          ...describeError(error),
        });
      }
    }
  }

  async #applyNetwork(): Promise<void> {
    const instances: ForwardedInstance[] = [];
    for (const record of this.#records.values()) {
      const slot = this.#allocator.lookup(record.appId);
      if (!slot) {
        continue;
      }
      instances.push({
        hostPort: slot.hostPort,
        guestPort: record.guestPort,
        hostIpv4: slot.hostIpv4,
        guestIpv4: slot.guestIpv4,
      });
    }
    try {
      await applyRuleset({
        runner: this.#options.runner,
        state: {
          instances,
          controlPlaneCidrs: this.#options.config.controlPlaneCidrs,
          guestDnsServers: this.#options.config.guestDnsServers,
        },
      });
    } catch (error) {
      logger.error({ message: 'firewall apply failed', ...describeError(error) });
    }
  }

  async #applyRoutes(): Promise<void> {
    try {
      await this.#options.proxy.apply({ routes: this.routes() });
    } catch (error) {
      logger.error({ message: 'proxy reload failed', ...describeError(error) });
    }
  }

  async #persist(): Promise<void> {
    await writeJsonFile({
      path: this.#options.config.slotsFile,
      value: this.#allocator.toRecords(),
    });
    await writeJsonFile({ path: this.#options.config.instancesFile, value: this.records() });
  }
}

export function mergeVolumeReports({
  existing,
  updates,
}: {
  existing: readonly ReportedVolume[];
  updates: readonly ReportedVolume[];
}): ReportedVolume[] {
  const merged = new Map(existing.map((report) => [report.volumeId, report] as const));
  for (const report of updates) {
    merged.set(report.volumeId, report);
  }
  return [...merged.values()];
}

const truncate = (value: string) => value.slice(0, MAX_MESSAGE_LENGTH);
