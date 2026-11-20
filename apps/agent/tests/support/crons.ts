import { CronQuerySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { LOG_SOURCE } from '#tests/support/fixtures.ts';

export const CRON_JOB = { schedule: '*/5 * * * *', command: 'echo hello' };
export const CRON_QUERY = Value.Parse(CronQuerySchema, { ...LOG_SOURCE, queryId: 'query-1' });
