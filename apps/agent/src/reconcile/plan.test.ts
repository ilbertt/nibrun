import { describe, expect, test } from 'bun:test';
import type {
  AppId,
  CheckpointId,
  DeploymentId,
  DesiredInstance,
  DesiredVolume,
  HostDesiredState,
  HostId,
  InstanceId,
  ObjectKey,
  Sha256Digest,
  VolumeId,
} from '@repo/protocol';
import {
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
} from '@repo/protocol';
import { type ObservedState, planReconcile } from '#reconcile/plan.ts';

const APP = 'app-1' as AppId;
const VOLUME = 'vol-1' as VolumeId;
const INSTANCE = 'inst-1' as InstanceId;
const DEPLOYMENT = 'dep-1' as DeploymentId;
const DIGEST_HEX_LENGTH = 64;
const ARTIFACT_SIZE_BYTES = 1_024;
const VOLUME_SIZE_BYTES = 4_096;
const GROWN_VOLUME_SIZE_BYTES = 8_192;
const DIGEST = 'a'.repeat(DIGEST_HEX_LENGTH) as Sha256Digest;

const desiredInstance = (overrides: Partial<DesiredInstance> = {}): DesiredInstance => ({
  instanceId: INSTANCE,
  appId: APP,
  deploymentId: DEPLOYMENT,
  volumeId: VOLUME,
  desiredState: 'running',
  artifact: {
    digest: DIGEST,
    sizeBytes: ARTIFACT_SIZE_BYTES,
    objectKey: 'artifacts/a' as ObjectKey,
  },
  config: {
    guestPort: DEFAULT_GUEST_PORT,
    args: [],
    environment: {},
    resources: DEFAULT_INSTANCE_RESOURCES,
    healthCheck: DEFAULT_HEALTH_CHECK,
    restartPolicy: DEFAULT_RESTART_POLICY,
  },
  hostnames: [],
  ...overrides,
});

const desiredVolume = (overrides: Partial<DesiredVolume> = {}): DesiredVolume => ({
  volumeId: VOLUME,
  appId: APP,
  sizeBytes: VOLUME_SIZE_BYTES,
  desiredState: 'present',
  ...overrides,
});

const desiredState = (overrides: Partial<HostDesiredState> = {}): HostDesiredState => ({
  hostId: 'host-1' as HostId,
  generation: 1,
  volumes: [],
  instances: [],
  checkpoints: [],
  exports: [],
  ...overrides,
});

const observedState = (overrides: Partial<ObservedState> = {}): ObservedState => ({
  instances: [],
  volumes: [],
  checkpoints: [],
  ...overrides,
});

describe('instances are authoritative', () => {
  test('a desired instance nothing is running is started', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState(),
    });
    expect(plan.instances).toEqual([{ action: 'start', desired: desiredInstance() }]);
  });

  test('a running instance the control plane does not mention is stopped', () => {
    const plan = planReconcile({
      desired: desiredState(),
      observed: observedState({
        instances: [
          {
            instanceId: INSTANCE,
            appId: APP,
            volumeId: VOLUME,
            deploymentId: DEPLOYMENT,
            present: true,
            running: true,
            exited: false,
          },
        ],
      }),
    });
    expect(plan.instances).toEqual([
      { action: 'stop', instanceId: INSTANCE, reason: 'not-desired' },
    ]);
  });

  test('a stopped instance the control plane does not mention is forgotten', () => {
    const plan = planReconcile({
      desired: desiredState(),
      observed: observedState({
        instances: [
          {
            instanceId: INSTANCE,
            present: true,
            running: false,
            exited: true,
          },
        ],
      }),
    });
    expect(plan.instances).toEqual([{ action: 'forget', instanceId: INSTANCE }]);
  });

  test('a deployment change replaces rather than restarts', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [
          {
            instanceId: INSTANCE,
            appId: APP,
            volumeId: VOLUME,
            deploymentId: 'dep-0' as DeploymentId,
            present: true,
            running: true,
            exited: false,
          },
        ],
      }),
    });
    expect(plan.instances[0]?.action).toBe('replace');
  });

  test('a unit with no record is treated as a mismatch, not as converged', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [{ instanceId: INSTANCE, present: true, running: true, exited: false }],
      }),
    });
    expect(plan.instances[0]?.action).toBe('replace');
  });

  test('a VM that exited on its own is not booted again', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [
          {
            instanceId: INSTANCE,
            appId: APP,
            volumeId: VOLUME,
            deploymentId: DEPLOYMENT,
            present: true,
            running: false,
            exited: true,
          },
        ],
      }),
    });
    expect(plan.instances).toEqual([{ action: 'none', instanceId: INSTANCE }]);
  });

  test('a staging failure that never reached systemd is retried', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [
          {
            instanceId: INSTANCE,
            appId: APP,
            volumeId: VOLUME,
            deploymentId: DEPLOYMENT,
            present: true,
            running: false,
            exited: false,
          },
        ],
      }),
    });
    expect(plan.instances[0]?.action).toBe('start');
  });

  test('desiredState stopped stops a running instance and leaves a stopped one alone', () => {
    const stopped = desiredInstance({ desiredState: 'stopped' });
    const running = planReconcile({
      desired: desiredState({ instances: [stopped] }),
      observed: observedState({
        instances: [{ instanceId: INSTANCE, present: true, running: true, exited: false }],
      }),
    });
    expect(running.instances[0]).toEqual({
      action: 'stop',
      instanceId: INSTANCE,
      reason: 'desired-stopped',
    });

    const already = planReconcile({
      desired: desiredState({ instances: [stopped] }),
      observed: observedState(),
    });
    expect(already.instances).toEqual([{ action: 'none', instanceId: INSTANCE }]);
  });
});

describe('volumes are not authoritative', () => {
  test('a volume missing from desired state is left completely alone', () => {
    const plan = planReconcile({
      desired: desiredState(),
      observed: observedState({
        volumes: [{ volumeId: VOLUME, attached: true, sizeBytes: VOLUME_SIZE_BYTES }],
      }),
    });
    expect(plan.volumes).toEqual([]);
  });

  test('removal requires an explicit absent', () => {
    const plan = planReconcile({
      desired: desiredState({ volumes: [desiredVolume({ desiredState: 'absent' })] }),
      observed: observedState({
        volumes: [{ volumeId: VOLUME, attached: true, sizeBytes: VOLUME_SIZE_BYTES }],
      }),
    });
    expect(plan.volumes[0]?.action).toBe('teardown');
  });

  test('a volume still held by an instance is blocked rather than destroyed', () => {
    const plan = planReconcile({
      desired: desiredState({ volumes: [desiredVolume({ desiredState: 'absent' })] }),
      observed: observedState({
        volumes: [{ volumeId: VOLUME, attached: true, sizeBytes: VOLUME_SIZE_BYTES }],
        instances: [
          {
            instanceId: INSTANCE,
            appId: APP,
            volumeId: VOLUME,
            deploymentId: DEPLOYMENT,
            present: true,
            running: false,
            exited: true,
          },
        ],
      }),
    });
    expect(plan.volumes[0]).toEqual({
      action: 'blocked',
      desired: desiredVolume({ desiredState: 'absent' }),
      blockedBy: [INSTANCE],
    });
  });

  test('an unattached volume is provisioned and a grown one re-provisioned', () => {
    const missing = planReconcile({
      desired: desiredState({ volumes: [desiredVolume()] }),
      observed: observedState(),
    });
    expect(missing.volumes[0]?.action).toBe('provision');

    const small = planReconcile({
      desired: desiredState({ volumes: [desiredVolume({ sizeBytes: GROWN_VOLUME_SIZE_BYTES })] }),
      observed: observedState({
        volumes: [{ volumeId: VOLUME, attached: true, sizeBytes: VOLUME_SIZE_BYTES }],
      }),
    });
    expect(small.volumes[0]?.action).toBe('provision');

    const converged = planReconcile({
      desired: desiredState({ volumes: [desiredVolume()] }),
      observed: observedState({
        volumes: [{ volumeId: VOLUME, attached: true, sizeBytes: VOLUME_SIZE_BYTES }],
      }),
    });
    expect(converged.volumes).toEqual([{ action: 'none', volumeId: VOLUME }]);
  });
});

describe('checkpoints', () => {
  const checkpointId = 'chk-1' as CheckpointId;

  test('present creates only what is missing, absent deletes only what exists', () => {
    const create = planReconcile({
      desired: desiredState({
        checkpoints: [{ checkpointId, volumeId: VOLUME, desiredState: 'present' }],
      }),
      observed: observedState(),
    });
    expect(create.checkpoints[0]?.action).toBe('create');

    const already = planReconcile({
      desired: desiredState({
        checkpoints: [{ checkpointId, volumeId: VOLUME, desiredState: 'present' }],
      }),
      observed: observedState({ checkpoints: [{ checkpointId, volumeId: VOLUME }] }),
    });
    expect(already.checkpoints[0]?.action).toBe('none');

    const remove = planReconcile({
      desired: desiredState({
        checkpoints: [{ checkpointId, volumeId: VOLUME, desiredState: 'absent' }],
      }),
      observed: observedState({ checkpoints: [{ checkpointId, volumeId: VOLUME }] }),
    });
    expect(remove.checkpoints[0]?.action).toBe('delete');
  });
});
