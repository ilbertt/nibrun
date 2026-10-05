import type { Print } from '@parshjs/core';
import { CRON_TIME_ZONE } from '@repo/api/domain';
import type { PublicApiClient } from '@repo/api-client/public';
import { readCrons } from '@repo/app-operations';
import { z } from 'zod';
import { announcedDeployment } from '#lib/apps.ts';
import { defineOutput } from '#lib/output.ts';

export const CRONS_OUTPUT = defineOutput({
  schema: z.object({
    appId: z.string(),
    deploymentId: z.string(),
    enabled: z.boolean(),
    timeZone: z.literal(CRON_TIME_ZONE),
    jobs: z.array(z.object({ jobId: z.string(), schedule: z.string(), command: z.string() })),
  }),
  render: ({ value, out }) => {
    out.info(`Cron execution ${value.enabled ? 'enabled' : 'disabled'} · ${value.timeZone}`);
    if (value.jobs.length === 0) {
      out.info('No cron jobs registered.');
      return;
    }
    for (const job of value.jobs) {
      out.info(`${job.jobId} · ${job.schedule}`);
      out.info(`  ${job.command}`);
    }
  },
});

export async function listCrons({
  api,
  appId,
  deploymentId,
  print,
}: {
  api: PublicApiClient;
  appId: string;
  deploymentId: string | undefined;
  print: Print;
}) {
  const addressed = await announcedDeployment({
    api,
    appId,
    deploymentId,
    operation: 'crons',
    print,
  });
  return readCrons({
    api,
    appId: addressed.appId,
    deploymentId: addressed.deploymentId,
    signal: undefined,
  });
}
