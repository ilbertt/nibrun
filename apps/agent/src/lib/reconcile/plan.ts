import type {
  AppId,
  CheckpointId,
  DeploymentId,
  DesiredCheckpoint,
  DesiredExport,
  DesiredInstance,
  DesiredVolume,
  ExportId,
  HostDesiredState,
  ObjectKey,
  VolumeId,
} from '@repo/protocol';

export type ObservedInstance = {
  readonly appId: AppId;
  /** Absent for a unit this agent has no record of — a host that lost its state file. */
  readonly volumeId?: VolumeId;
  readonly deploymentId?: DeploymentId;
  readonly present: boolean;
  readonly running: boolean;
  /** Stopped without being asked to: left alone, because rebooting would hide a broken deploy. */
  readonly exited: boolean;
};

export type ObservedVolume = {
  readonly volumeId: VolumeId;
  readonly appId: AppId;
  readonly attached: boolean;
  readonly sizeBytes: number;
  readonly storagePrefix: ObjectKey;
  readonly devicePath?: string;
};

export type ObservedCheckpoint = {
  readonly checkpointId: CheckpointId;
  readonly volumeId: VolumeId;
};

/**
 * Remembered rather than observed: the host holds write-only credentials on the export bucket,
 * so re-writing on doubt would re-upload a tenant's whole dataset on every agent restart.
 */
export type ObservedExport = {
  readonly exportId: ExportId;
  readonly written: boolean;
};

export type ObservedState = {
  readonly instances: readonly ObservedInstance[];
  readonly volumes: readonly ObservedVolume[];
  readonly checkpoints: readonly ObservedCheckpoint[];
  readonly exports: readonly ObservedExport[];
};

export const INSTANCE_STOP_REASONS = ['desired-stopped', 'not-desired', 'superseded'] as const;

export type InstanceStopReason = (typeof INSTANCE_STOP_REASONS)[number];

export type InstancePlan =
  | { readonly action: 'start'; readonly desired: DesiredInstance }
  | { readonly action: 'replace'; readonly desired: DesiredInstance }
  | {
      readonly action: 'stop';
      readonly appId: AppId;
      readonly reason: InstanceStopReason;
    }
  | { readonly action: 'forget'; readonly appId: AppId }
  | { readonly action: 'none'; readonly appId: AppId };

export type VolumePlan =
  | { readonly action: 'provision'; readonly desired: DesiredVolume }
  | { readonly action: 'teardown'; readonly desired: DesiredVolume }
  | {
      readonly action: 'blocked';
      readonly desired: DesiredVolume;
      readonly blockedBy: readonly AppId[];
    }
  | { readonly action: 'none'; readonly volumeId: VolumeId };

export type CheckpointPlan =
  | { readonly action: 'create'; readonly desired: DesiredCheckpoint }
  | { readonly action: 'delete'; readonly desired: DesiredCheckpoint }
  | { readonly action: 'none'; readonly checkpointId: CheckpointId };

/** `forget`, not `delete`: expiry is the bucket's lifecycle rule, which is what makes it unforgettable. */
export type ExportPlan =
  | { readonly action: 'write'; readonly desired: DesiredExport }
  | { readonly action: 'forget'; readonly exportId: ExportId }
  | { readonly action: 'none'; readonly exportId: ExportId };

export type ReconcilePlan = {
  readonly instances: readonly InstancePlan[];
  readonly volumes: readonly VolumePlan[];
  readonly checkpoints: readonly CheckpointPlan[];
  readonly exports: readonly ExportPlan[];
};

/**
 * A blocked teardown converges on a later pass, and nothing else would run one: only desired
 * state moving triggers a reconcile, and deferred work does not move it.
 */
export function hasDeferredWork(plan: ReconcilePlan): boolean {
  return plan.volumes.some((action) => action.action === 'blocked');
}

const byId = <Item, Key extends string>({
  items,
  key,
}: {
  items: readonly Item[];
  key: (item: Item) => Key;
}) => new Map(items.map((item) => [key(item), item] as const));

/**
 * The asymmetry is the point. `instances` is authoritative, so a microVM the control plane does
 * not mention is stopped. `volumes` is not: removal is only ever an explicit `absent`, because a
 * truncated response must not be able to destroy a tenant's filesystem.
 */
export function planReconcile({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}): ReconcilePlan {
  return {
    instances: planInstances({ desired, observed }),
    volumes: planVolumes({ desired, observed }),
    checkpoints: planCheckpoints({ desired, observed }),
    exports: planExports({ desired, observed }),
  };
}

function planInstances({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}): InstancePlan[] {
  const observedById = byId({ items: observed.instances, key: (instance) => instance.appId });
  const plans: InstancePlan[] = [];

  for (const wanted of desired.instances) {
    const current = observedById.get(wanted.appId);
    if (wanted.desiredState === 'stopped') {
      plans.push(
        current?.running
          ? { action: 'stop', appId: wanted.appId, reason: 'desired-stopped' }
          : { action: 'none', appId: wanted.appId },
      );
      continue;
    }
    if (!current?.present) {
      plans.push({ action: 'start', desired: wanted });
      continue;
    }
    if (current.deploymentId !== wanted.deploymentId) {
      plans.push({ action: 'replace', desired: wanted });
      continue;
    }
    if (current.running) {
      plans.push({ action: 'none', appId: wanted.appId });
      continue;
    }
    plans.push(
      current.exited
        ? { action: 'none', appId: wanted.appId }
        : { action: 'start', desired: wanted },
    );
  }

  const desiredIds = new Set(desired.instances.map((instance) => instance.appId));
  for (const current of observed.instances) {
    if (desiredIds.has(current.appId)) {
      continue;
    }
    plans.push(
      current.running
        ? { action: 'stop', appId: current.appId, reason: 'not-desired' }
        : { action: 'forget', appId: current.appId },
    );
  }

  return plans;
}

function planVolumes({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}): VolumePlan[] {
  const observedById = byId({ items: observed.volumes, key: (volume) => volume.volumeId });
  const usedBy = new Map<VolumeId, AppId[]>();
  for (const instance of observed.instances) {
    if (!instance.present || instance.volumeId === undefined) {
      continue;
    }
    usedBy.set(instance.volumeId, [...(usedBy.get(instance.volumeId) ?? []), instance.appId]);
  }
  for (const instance of desired.instances) {
    if (!usedBy.has(instance.volumeId)) {
      usedBy.set(instance.volumeId, []);
    }
  }

  return desired.volumes.map((wanted): VolumePlan => {
    const current = observedById.get(wanted.volumeId);
    if (wanted.desiredState === 'absent') {
      const holders = usedBy.get(wanted.volumeId) ?? [];
      if (holders.length > 0) {
        return { action: 'blocked', desired: wanted, blockedBy: holders };
      }
      return current
        ? { action: 'teardown', desired: wanted }
        : { action: 'none', volumeId: wanted.volumeId };
    }
    if (!current?.attached || current.sizeBytes < wanted.sizeBytes) {
      return { action: 'provision', desired: wanted };
    }
    return { action: 'none', volumeId: wanted.volumeId };
  });
}

/**
 * Not a diff against reality: the host cannot see the bucket it writes to, so a bundle already
 * written is left alone even if the object has since expired underneath it.
 */
function planExports({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}): ExportPlan[] {
  const writtenIds = new Set(
    observed.exports.filter((current) => current.written).map((current) => current.exportId),
  );
  return desired.exports.map((wanted): ExportPlan => {
    if (wanted.desiredState === 'absent') {
      return { action: 'forget', exportId: wanted.exportId };
    }
    return writtenIds.has(wanted.exportId)
      ? { action: 'none', exportId: wanted.exportId }
      : { action: 'write', desired: wanted };
  });
}

function planCheckpoints({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}): CheckpointPlan[] {
  const observedIds = new Set(observed.checkpoints.map((checkpoint) => checkpoint.checkpointId));
  return desired.checkpoints.map((wanted): CheckpointPlan => {
    const exists = observedIds.has(wanted.checkpointId);
    if (wanted.desiredState === 'present') {
      return exists
        ? { action: 'none', checkpointId: wanted.checkpointId }
        : { action: 'create', desired: wanted };
    }
    return exists
      ? { action: 'delete', desired: wanted }
      : { action: 'none', checkpointId: wanted.checkpointId };
  });
}
