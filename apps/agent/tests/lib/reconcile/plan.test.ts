import { describe, expect, test } from 'bun:test';
import { DeploymentIdSchema, Value } from '@repo/protocol';
import { hasDeferredWork, planReconcile } from '#lib/reconcile/plan.ts';
import {
  APP_ID,
  CHECKPOINT_ID,
  desiredCheckpoint,
  desiredExport,
  desiredInstance,
  desiredState,
  desiredVolume,
  EXPORT_ID,
  observedInstance,
  observedState,
  observedVolume,
  VOLUME_ID,
  VOLUME_SIZE_BYTES,
} from '#tests/support/fixtures.ts';

const GROWN_VOLUME_SIZE_BYTES = VOLUME_SIZE_BYTES * 2;

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
      observed: observedState({ instances: [observedInstance()] }),
    });
    expect(plan.instances).toEqual([{ action: 'stop', appId: APP_ID, reason: 'not-desired' }]);
  });

  test('a stopped instance the control plane does not mention is forgotten', () => {
    const plan = planReconcile({
      desired: desiredState(),
      observed: observedState({
        instances: [
          {
            appId: APP_ID,
            present: true,
            running: false,
            exited: true,
          },
        ],
      }),
    });
    expect(plan.instances).toEqual([{ action: 'forget', appId: APP_ID }]);
  });

  test('a deployment change replaces rather than restarts', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [observedInstance({ deploymentId: Value.Parse(DeploymentIdSchema, 'dep-0') })],
      }),
    });
    expect(plan.instances[0]?.action).toBe('replace');
  });

  test('a unit with no record is treated as a mismatch, not as converged', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [{ appId: APP_ID, present: true, running: true, exited: false }],
      }),
    });
    expect(plan.instances[0]?.action).toBe('replace');
  });

  test('a VM that exited on its own is not booted again', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [observedInstance({ running: false, exited: true })],
      }),
    });
    expect(plan.instances).toEqual([{ action: 'none', appId: APP_ID }]);
  });

  // The shape a reboot produces: the agent's records survive on disk, so the instance is still
  // present and still wanted, but nothing has run since the host came up. Reading that as an
  // exit leaves the host serving nothing until somebody logs in. A staging failure that never
  // reached systemd looks the same, and is retried for the same reason.
  test('a VM that has not run since the host booted is started', () => {
    const plan = planReconcile({
      desired: desiredState({ instances: [desiredInstance()] }),
      observed: observedState({
        instances: [observedInstance({ running: false, exited: false })],
      }),
    });
    expect(plan.instances).toEqual([{ action: 'start', desired: desiredInstance() }]);
  });

  test('desiredState stopped stops a running instance and leaves a stopped one alone', () => {
    const stopped = desiredInstance({ desiredState: 'stopped' });
    const running = planReconcile({
      desired: desiredState({ instances: [stopped] }),
      observed: observedState({
        instances: [{ appId: APP_ID, present: true, running: true, exited: false }],
      }),
    });
    expect(running.instances[0]).toEqual({
      action: 'stop',
      appId: APP_ID,
      reason: 'desired-stopped',
    });

    const already = planReconcile({
      desired: desiredState({ instances: [stopped] }),
      observed: observedState(),
    });
    expect(already.instances).toEqual([{ action: 'none', appId: APP_ID }]);
  });
});

describe('volumes are not authoritative', () => {
  const absent = desiredVolume({ desiredState: 'absent' });

  test('a volume missing from desired state is left completely alone', () => {
    const plan = planReconcile({
      desired: desiredState(),
      observed: observedState({ volumes: [observedVolume()] }),
    });
    expect(plan.volumes).toEqual([]);
  });

  test('removal requires an explicit absent', () => {
    const plan = planReconcile({
      desired: desiredState({ volumes: [absent] }),
      observed: observedState({ volumes: [observedVolume()] }),
    });
    expect(plan.volumes[0]?.action).toBe('teardown');
  });

  test('a volume still held by an instance is blocked rather than destroyed', () => {
    const plan = planReconcile({
      desired: desiredState({ volumes: [absent] }),
      observed: observedState({
        volumes: [observedVolume()],
        instances: [observedInstance({ running: false, exited: true })],
      }),
    });
    expect(plan.volumes[0]).toEqual({
      action: 'blocked',
      desired: absent,
      blockedBy: [APP_ID],
    });
    // Deleting an app takes two passes — stop the instance, then tear the volume down — and
    // only a generation change runs a pass. Without this the second one never comes.
    expect(hasDeferredWork(plan)).toBe(true);
  });

  test('a plan that finished everything leaves nothing to re-run for', () => {
    const plan = planReconcile({
      desired: desiredState({ volumes: [desiredVolume()] }),
      observed: observedState({ volumes: [observedVolume()] }),
    });
    expect(plan.volumes[0]?.action).toBe('none');
    expect(hasDeferredWork(plan)).toBe(false);
  });

  test('an unattached volume is provisioned and a grown one re-provisioned', () => {
    const missing = planReconcile({
      desired: desiredState({ volumes: [desiredVolume()] }),
      observed: observedState(),
    });
    expect(missing.volumes[0]?.action).toBe('provision');

    const small = planReconcile({
      desired: desiredState({ volumes: [desiredVolume({ sizeBytes: GROWN_VOLUME_SIZE_BYTES })] }),
      observed: observedState({ volumes: [observedVolume()] }),
    });
    expect(small.volumes[0]?.action).toBe('provision');

    const converged = planReconcile({
      desired: desiredState({ volumes: [desiredVolume()] }),
      observed: observedState({ volumes: [observedVolume()] }),
    });
    expect(converged.volumes).toEqual([{ action: 'none', volumeId: VOLUME_ID }]);
  });
});

describe('checkpoints', () => {
  const observed = observedState({
    checkpoints: [{ checkpointId: CHECKPOINT_ID, volumeId: VOLUME_ID }],
  });

  test('present creates only what is missing, absent deletes only what exists', () => {
    const create = planReconcile({
      desired: desiredState({ checkpoints: [desiredCheckpoint()] }),
      observed: observedState(),
    });
    expect(create.checkpoints[0]?.action).toBe('create');

    const already = planReconcile({
      desired: desiredState({ checkpoints: [desiredCheckpoint()] }),
      observed,
    });
    expect(already.checkpoints[0]?.action).toBe('none');

    const remove = planReconcile({
      desired: desiredState({ checkpoints: [desiredCheckpoint({ desiredState: 'absent' })] }),
      observed,
    });
    expect(remove.checkpoints[0]?.action).toBe('delete');
  });
});

describe('exports', () => {
  test('a bundle this host has not written is written', () => {
    const plan = planReconcile({
      desired: desiredState({ exports: [desiredExport()] }),
      observed: observedState(),
    });
    expect(plan.exports).toEqual([{ action: 'write', desired: desiredExport() }]);
  });

  test('a bundle already written is never written twice', () => {
    const plan = planReconcile({
      desired: desiredState({ exports: [desiredExport()] }),
      observed: observedState({ exports: [{ exportId: EXPORT_ID, written: true }] }),
    });
    expect(plan.exports[0]?.action).toBe('none');
  });

  // A failed export is remembered as a record but not as a bundle, so the next reconcile is
  // what retries it — the one case where re-reading the whole filesystem is the right answer.
  test('a bundle that failed is retried', () => {
    const plan = planReconcile({
      desired: desiredState({ exports: [desiredExport()] }),
      observed: observedState({ exports: [{ exportId: EXPORT_ID, written: false }] }),
    });
    expect(plan.exports[0]?.action).toBe('write');
  });

  test('absent forgets the record rather than deleting an object it cannot reach', () => {
    const plan = planReconcile({
      desired: desiredState({ exports: [desiredExport({ desiredState: 'absent' })] }),
      observed: observedState({ exports: [{ exportId: EXPORT_ID, written: true }] }),
    });
    expect(plan.exports).toEqual([{ action: 'forget', exportId: EXPORT_ID }]);
  });

  // `absent` only reaches a record the control plane still has. One it never had, or has lost,
  // is a record nothing would ever withdraw — and the host reports it for as long as it runs.
  test('a record desired state does not mention at all is forgotten too', () => {
    const plan = planReconcile({
      desired: desiredState({ exports: [] }),
      observed: observedState({ exports: [{ exportId: EXPORT_ID, written: true }] }),
    });
    expect(plan.exports).toEqual([{ action: 'forget', exportId: EXPORT_ID }]);
  });
});
