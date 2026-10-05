import { TenantEnvironmentSchema } from '@repo/api/domain';
import {
  CRON_TIME_ZONE,
  parseMessage,
  type TenantEnvironment,
  type Timestamp,
} from '@repo/protocol';
import { Data, Effect } from 'effect';
import { type CronJobDefinitions, CrontabSchema, MAX_CRONTAB_BYTES } from '#lib/cron/model.ts';
import { validateCronJobs } from '#lib/cron/schedule.ts';
import { decode } from '#lib/protocol.ts';

const ENVIRONMENT_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/;
const FIVE_FIELD_JOB = /^(\S+(?:[ \t]+\S+){4})[ \t]+(.+)$/;
const ALIAS_JOB = /^(\S+)[ \t]+(.+)$/;
const CRONTAB_REFUSALS = {
  'too-large': 'The crontab exceeds the maximum size.',
  line: 'Each cron job needs a schedule and a command.',
  quote: 'A crontab environment value has an unmatched quote.',
  timezone: 'Cron schedules use UTC; another CRON_TZ is not supported.',
} as const;

export class InvalidCrontab extends Data.TaggedError('InvalidCrontab')<{
  readonly reason: keyof typeof CRONTAB_REFUSALS;
}> {
  override get message() {
    return CRONTAB_REFUSALS[this.reason];
  }
}

function environmentValue(text: string) {
  const value = text.trim();
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    return Effect.succeed(value);
  }
  return value.length > 1 && value.endsWith(quote)
    ? Effect.succeed(value.slice(1, -1))
    : Effect.fail(new InvalidCrontab({ reason: 'quote' }));
}

function cronLine(line: string) {
  const match = line.match(line.startsWith('@') ? ALIAS_JOB : FIVE_FIELD_JOB);
  return match?.[1] && match[2]
    ? Effect.succeed({ schedule: match[1], command: match[2] })
    : Effect.fail(new InvalidCrontab({ reason: 'line' }));
}

function cronEnvironment({
  environment,
  name,
  text,
}: {
  environment: TenantEnvironment;
  name: string;
  text: string;
}) {
  return Effect.gen(function* () {
    const value = yield* environmentValue(text);
    if (name === 'CRON_TZ' && value !== CRON_TIME_ZONE) {
      return yield* new InvalidCrontab({ reason: 'timezone' });
    }
    return yield* decode(() =>
      parseMessage({ schema: TenantEnvironmentSchema, value: { ...environment, [name]: value } }),
    );
  });
}

export function parseCrontab({ text, after }: { text: string; after: Timestamp }) {
  return Effect.gen(function* () {
    if (Buffer.byteLength(text, 'utf8') > MAX_CRONTAB_BYTES) {
      return yield* new InvalidCrontab({ reason: 'too-large' });
    }
    const crontab = yield* decode(() => parseMessage({ schema: CrontabSchema, value: text }));
    let environment: TenantEnvironment = {};
    const jobs: CronJobDefinitions = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trimStart();
      if (line.trim().length === 0 || line.startsWith('#')) {
        continue;
      }
      const assignment = line.match(ENVIRONMENT_ASSIGNMENT);
      if (assignment?.[1] !== undefined && assignment[2] !== undefined) {
        environment = yield* cronEnvironment({
          environment,
          name: assignment[1],
          text: assignment[2],
        });
        continue;
      }
      jobs.push({
        ...(yield* cronLine(line)),
        environment: { ...environment },
      });
    }
    yield* validateCronJobs({ jobs, after });
    return { jobs, crontab };
  });
}
