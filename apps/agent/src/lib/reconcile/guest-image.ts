import type { AppId, DesiredInstance, HostDesiredState } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { startInstance, stopInstance } from '#lib/reconcile/instances.ts';
import type { ObservedState } from '#lib/reconcile/plan.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { adoptedGuestImage, readBootedGuestImage } from '#lib/vm/guest-image.ts';
import * as Systemd from '#lib/vm/systemd.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { CronActivity } from '#services/cron-activity.service.ts';
import { VmManager } from '#services/vm-manager.service.ts';

type GuestImageRolloutPlan =
  | { readonly action: 'upgrade'; readonly desired: DesiredInstance }
  | { readonly action: 'confirm'; readonly appId: AppId }
  | { readonly action: 'wait' }
  | { readonly action: 'none' };

export function planGuestImageRollout({
  instances,
  records,
  running,
  version,
}: {
  instances: readonly DesiredInstance[];
  records: ReadonlyMap<AppId, InstanceRecord>;
  running: ReadonlySet<AppId>;
  version: string;
}): GuestImageRolloutPlan {
  const wanted = instances.filter((instance) => instance.desiredState !== 'stopped');
  for (const instance of wanted) {
    const record = records.get(instance.appId);
    if (
      record?.deploymentId !== instance.deploymentId ||
      record.guestImageUpgradeTarget === undefined
    ) {
      continue;
    }
    return record.guestImageVersion === version &&
      record.health.everHealthy &&
      (record.state === 'running' || record.state === 'idle')
      ? { action: 'confirm', appId: instance.appId }
      : { action: 'wait' };
  }
  const outdated = wanted.find((instance) => {
    const record = records.get(instance.appId);
    return (
      running.has(instance.appId) &&
      record?.deploymentId === instance.deploymentId &&
      record.guestImageVersion !== version
    );
  });
  return outdated === undefined ? { action: 'none' } : { action: 'upgrade', desired: outdated };
}

function readRunningGuestImages({
  records,
  running,
}: {
  records: ReadonlyMap<AppId, InstanceRecord>;
  running: ReadonlySet<AppId>;
}) {
  return Effect.gen(function* () {
    const vms = yield* VmManager;
    const updated = new Map(records);
    for (const appId of running) {
      const record = updated.get(appId);
      if (record === undefined) {
        continue;
      }
      const booted = yield* readBootedGuestImage(vms.workingDir(appId));
      const image = Option.getOrUndefined(booted);
      updated.set(appId, {
        ...record,
        guestImageVersion: image?.deploymentId === record.deploymentId ? image.version : undefined,
      });
    }
    return updated;
  });
}

export function applyGuestImageRollout({
  desired,
  observed,
}: {
  desired: HostDesiredState;
  observed: ObservedState;
}) {
  return Effect.gen(function* () {
    if (desired.instances.every((instance) => instance.desiredState === 'stopped')) {
      return false;
    }
    const config = yield* AgentConfig;
    const vms = yield* VmManager;
    const activity = yield* CronActivity;
    const target = yield* adoptedGuestImage(config);
    const running = new Set(
      observed.instances.filter((instance) => instance.running).map((instance) => instance.appId),
    );
    const records = yield* readRunningGuestImages({
      records: (yield* AgentState.snapshot).records,
      running,
    });
    const plan = planGuestImageRollout({
      instances: desired.instances,
      records,
      running,
      version: target.version,
    });
    if (plan.action === 'none') {
      return false;
    }
    if (plan.action === 'confirm') {
      yield* AgentState.updateRecord({
        appId: plan.appId,
        change: (record) => ({ ...record, guestImageUpgradeTarget: undefined }),
      });
      return true;
    }
    if (plan.action === 'wait') {
      return true;
    }
    const appId = plan.desired.appId;
    yield* activity.whenIdle({
      appId,
      effect: Effect.gen(function* () {
        const current = yield* AgentState.snapshot;
        if (!current.isolated || current.snapshotting.has(appId)) {
          return;
        }
        const unitBeforeUpgrade = (yield* Systemd.statuses([appId])).get(appId);
        if (!unitBeforeUpgrade?.active) {
          return;
        }
        const booted = yield* readBootedGuestImage(vms.workingDir(appId));
        if (
          Option.isSome(booted) &&
          booted.value.deploymentId === plan.desired.deploymentId &&
          booted.value.version === target.version
        ) {
          return;
        }
        yield* AgentState.updateRecord({
          appId,
          change: (record) => ({ ...record, guestImageUpgradeTarget: target.version }),
        });
        yield* stopInstance({ appId, reason: 'guest-image-upgrade' });
        const unit = (yield* Systemd.statuses([appId])).get(appId);
        if (unit?.active !== false) {
          return yield* Effect.logError(
            'guest image upgrade stopped: the old microVM is still running',
          ).pipe(Effect.annotateLogs({ appId }));
        }
        yield* startInstance(plan.desired);
      }),
    });
    return true;
  });
}
