import type { DesiredInstance } from '@repo/protocol';
import { Data } from 'effect';
import type { CronRunLogContext } from '#lib/cron/execution-logs.ts';
import type { CronJobDefinition } from '#lib/cron/model.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

export type CronDispatch = {
  readonly context: CronRunLogContext;
  readonly job: CronJobDefinition;
};

export class CronExecutionUnavailable extends Data.TaggedError('CronExecutionUnavailable') {
  override get message() {
    return 'The current deployment is not available for cron execution.';
  }
}

export function canRunCron({
  wanted,
  record,
  deploymentId,
}: {
  wanted: DesiredInstance | undefined;
  record: InstanceRecord | undefined;
  deploymentId: CronRunLogContext['deploymentId'];
}) {
  return (
    wanted?.deploymentId === deploymentId &&
    wanted.desiredState !== 'stopped' &&
    record?.deploymentId === deploymentId &&
    record.desiredRunning &&
    (record.state === 'idle' ||
      (!record.stopRequested &&
        (record.state === 'running' ||
          record.state === 'starting' ||
          record.state === 'unhealthy')))
  );
}
