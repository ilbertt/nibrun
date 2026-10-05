import { Buffer } from 'node:buffer';
import { CronJobIdSchema, Value } from '@repo/protocol';
import type { CronTable } from '#lib/cron/model.ts';

export function registeredCronJobs(table: CronTable) {
  return Array.from(table.jobs.entries(), ([index, job]) => {
    const hash = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify([table.appId, table.deploymentId, index, job]))
      .digest();
    return {
      job,
      context: {
        appId: table.appId,
        deploymentId: table.deploymentId,
        cronJobId: Value.Parse(CronJobIdSchema, `cron-${Buffer.from(hash).toString('base64url')}`),
      },
    };
  });
}
