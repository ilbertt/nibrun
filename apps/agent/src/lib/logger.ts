import { Cause, Config, ConfigError, Effect, Either, Layer, Logger, LogLevel } from 'effect';

const LEVELS = new Map<string, LogLevel.LogLevel>(
  LogLevel.allLevels.map((level) => [level.label, level]),
);

const configuredLevel = Config.string('AGENT_LOG_LEVEL').pipe(
  Config.mapOrFail((value) =>
    Either.fromNullable(LEVELS.get(value.toUpperCase()), () =>
      ConfigError.InvalidData(['AGENT_LOG_LEVEL'], `${value} is not a log level`),
    ),
  ),
  Config.withDefault(LogLevel.Info),
);

// systemd captures this into the journal, separately from the tenant stream this process forwards.
const stderrJson = Logger.make<unknown, void>(({ annotations, cause, date, logLevel, message }) => {
  const line = JSON.stringify({
    ts: date.toISOString(),
    level: logLevel.label.toLowerCase(),
    message,
    ...Object.fromEntries(annotations),
    ...(Cause.isEmpty(cause) ? {} : { error: Cause.pretty(cause) }),
  });
  process.stderr.write(`${line}\n`);
});

export const AgentLogger = Layer.unwrapEffect(
  Effect.map(configuredLevel, (level) =>
    Layer.merge(
      Logger.replace(Logger.defaultLogger, stderrJson),
      Logger.minimumLogLevel(level),
    ),
  ),
);
