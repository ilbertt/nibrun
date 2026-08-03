import type {
  AppId,
  CheckpointId,
  DeploymentId,
  DesiredCheckpoint,
  DesiredInstance,
  DesiredVolume,
  HostDesiredState,
  InstanceId,
  VolumeId,
} from '@repo/protocol';

export type ObservedInstance = {
  instanceId: InstanceId;
  // Absent for a unit systemd knows about that this agent has no record of — which is what a
  // host looks like after its state file is lost. The identity is unrecoverable from the unit
  // alone, and every path below then treats it as a mismatch, which is the safe reading.
  appId?: AppId;
  volumeId?: VolumeId;
  deploymentId?: DeploymentId;
  // A unit systemd still knows about, whether or not it is currently active.
  present: boolean;
  running: boolean;
  // The VM stopped without this agent asking it to: the guest exhausted the tenant process's
  // restart budget and powered itself off, or Firecracker died. Booting it again here would
  // hide a broken deploy behind a host that retries forever, so it is left alone until the
  // reconciler says something new.
  exited: boolean;
};

export type ObservedVolume = {
  volumeId: VolumeId;
  attached: boolean;
  sizeBytes: number;
};

export type ObservedCheckpoint = {
  checkpointId: CheckpointId;
  volumeId: VolumeId;
};

export type ObservedState = {
  instances: ObservedInstance[];
  volumes: ObservedVolume[];
  checkpoints: ObservedCheckpoint[];
};

export const INSTANCE_STOP_REASONS = ['desired-stopped', 'not-desired', 'superseded'] as const;

export type InstanceStopReason = (typeof INSTANCE_STOP_REASONS)[number];

export type InstancePlan =
  | { action: 'start'; desired: DesiredInstance }
  | { action: 'replace'; desired: DesiredInstance }
  | { action: 'stop'; instanceId: InstanceId; reason: InstanceStopReason }
  | { action: 'forget'; instanceId: InstanceId }
  | { action: 'none'; instanceId: InstanceId };

export type VolumePlan =
  | { action: 'provision'; desired: DesiredVolume }
  | { action: 'teardown'; desired: DesiredVolume }
  | { action: 'blocked'; desired: DesiredVolume; blockedBy: InstanceId[] }
  | { action: 'none'; volumeId: VolumeId };

export type CheckpointPlan =
  | { action: 'create'; desired: DesiredCheckpoint }
  | { action: 'delete'; desired: DesiredCheckpoint }
  | { action: 'none'; checkpointId: CheckpointId };

export type ReconcilePlan = {
  instances: InstancePlan[];
  volumes: VolumePlan[];
  checkpoints: CheckpointPlan[];
};

const byId = <Item, Key extends string>({
  items,
  key,
}: {
  items: readonly Item[];
  key: (item: Item) => Key;
}) => new Map(items.map((item) => [key(item), item] as const));

/**
 * Diffs desired state against what the host is observed to be doing.
 *
 * The asymmetry between the two lists is the point. `instances` is authoritative, so a microVM
 * the control plane does not mention is one this host stops — that is what makes an orphaned
 * VM converge away without anybody sending a command. `volumes` is not: removal is only ever
 * an explicit `absent`, because a truncated or partially-written response must not be able to
 * destroy a tenant's filesystem. A volume missing from desired state is left exactly as it is.
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
  };
}

function planInstances({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}): InstancePlan[] {
  const observedById = byId({ items: observed.instances, key: (instance) => instance.instanceId });
  const plans: InstancePlan[] = [];

  for (const wanted of desired.instances) {
    const current = observedById.get(wanted.instanceId);
    if (wanted.desiredState === 'stopped') {
      plans.push(
        current?.running
          ? { action: 'stop', instanceId: wanted.instanceId, reason: 'desired-stopped' }
          : { action: 'none', instanceId: wanted.instanceId },
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
      plans.push({ action: 'none', instanceId: wanted.instanceId });
      continue;
    }
    plans.push(
      current.exited
        ? { action: 'none', instanceId: wanted.instanceId }
        : { action: 'start', desired: wanted },
    );
  }

  const desiredIds = new Set(desired.instances.map((instance) => instance.instanceId));
  for (const current of observed.instances) {
    if (desiredIds.has(current.instanceId)) {
      continue;
    }
    plans.push(
      current.running
        ? { action: 'stop', instanceId: current.instanceId, reason: 'not-desired' }
        : { action: 'forget', instanceId: current.instanceId },
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
  const usedBy = new Map<VolumeId, InstanceId[]>();
  for (const instance of observed.instances) {
    if (!instance.present || instance.volumeId === undefined) {
      continue;
    }
    usedBy.set(instance.volumeId, [...(usedBy.get(instance.volumeId) ?? []), instance.instanceId]);
  }
  for (const instance of desired.instances) {
    if (usedBy.has(instance.volumeId)) {
      continue;
    }
    usedBy.set(instance.volumeId, []);
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
