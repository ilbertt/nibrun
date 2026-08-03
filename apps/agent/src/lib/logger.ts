import { nowTimestamp } from '#lib/clock.ts';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const isLogLevel = (value: string): value is LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(value);

const configuredLevel = (): LogLevel => {
  const value = Bun.env.AGENT_LOG_LEVEL?.toLowerCase() ?? '';
  return isLogLevel(value) ? value : 'info';
};

let threshold = LEVEL_ORDER[configuredLevel()];

export const setLogLevel = ({ level }: { level: LogLevel }) => {
  threshold = LEVEL_ORDER[level];
};

export type LogEvent = { message: string } & Record<string, unknown>;

// One JSON object per line on stderr. systemd captures it into the journal, where the fields
// stay queryable — which is the only log transport this agent has until log shipping exists.
const emit = ({ level, event }: { level: LogLevel; event: LogEvent }) => {
  if (LEVEL_ORDER[level] < threshold) {
    return;
  }
  process.stderr.write(`${JSON.stringify({ ts: nowTimestamp(), level, ...event })}\n`);
};

export const describeError = (error: unknown) =>
  error instanceof Error
    ? { error: error.message, errorName: error.name }
    : { error: String(error) };

export const logger = {
  debug: (event: LogEvent) => emit({ level: 'debug', event }),
  info: (event: LogEvent) => emit({ level: 'info', event }),
  warn: (event: LogEvent) => emit({ level: 'warn', event }),
  error: (event: LogEvent) => emit({ level: 'error', event }),
};
