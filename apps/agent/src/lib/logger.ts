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
//
// The `<n>` prefix is the only thing journald reads a severity from. Without it every line a
// service writes is recorded at `info` — including a stack trace — because the priority is a
// property of the stream, not of what travels down it. journald strips the prefix as it parses it.
const stderrJson = Logger.make<unknown, void>(({ annotations, cause, date, logLevel, message }) => {
  const line = JSON.stringify({
    ts: date.toISOString(),
    level: logLevel.label.toLowerCase(),
    message,
    ...Object.fromEntries(annotations),
    ...(Cause.isEmpty(cause) ? {} : { error: Cause.pretty(cause) }),
  });
  process.stderr.write(`<${logLevel.syslog}>${line}\n`);
});

export const AgentLogger = Layer.unwrapEffect(
  Effect.map(configuredLevel, (level) =>
    Layer.merge(
      // The runtime installs the pretty logger, and `Logger.replace` removes the logger it is
      // given — so naming `Logger.defaultLogger` here removes nothing and leaves both running,
      // which is what put every event in the journal twice, once as JSON and once as prose.
      Logger.replace(Logger.prettyLoggerDefault, stderrJson),
      Logger.minimumLogLevel(level),
    ),
  ),
);
