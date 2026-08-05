import { Command, type CommandExecutor } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Duration, Effect, identity, Stream } from 'effect';
import {
  type CommandError,
  CommandFailed,
  type CommandRequest,
  type CommandResult,
  CommandTimedOut,
} from '#lib/exec.ts';

const DEFAULT_TIMEOUT = Duration.minutes(2);
const SUCCESS = 0;

export const run = (request: CommandRequest) =>
  Effect.flatMap(CommandRunner, (runner) => runner.run(request));

export const stdoutOf = (request: CommandRequest) =>
  Effect.flatMap(run(request), (result) =>
    result.code === SUCCESS
      ? Effect.succeed(result.stdout)
      : new CommandFailed({ command: request.command, result }),
  );

const build = ({ command: [executable, ...args], stdin, env }: CommandRequest) => {
  const command = Command.make(executable, ...args).pipe(env ? Command.env(env) : identity);
  return stdin === undefined ? command : Command.feed(command, stdin);
};

const collect = (stream: Stream.Stream<Uint8Array, PlatformError>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const execute = (request: CommandRequest) =>
  Effect.gen(function* () {
    const process = yield* Command.start(build(request));
    const [stdout, stderr, code] = yield* Effect.all(
      [collect(process.stdout), collect(process.stderr), process.exitCode],
      { concurrency: 'unbounded' },
    );
    return { code, stdout, stderr };
  }).pipe(
    Effect.scoped,
    Effect.timeoutFail({
      duration: request.timeout ?? DEFAULT_TIMEOUT,
      onTimeout: () => new CommandTimedOut({ command: request.command }),
    }),
    Effect.withSpan('exec', { attributes: { command: request.command[0] } }),
  );

export class CommandRunner extends Effect.Service<CommandRunner>()('CommandRunner', {
  effect: Effect.map(Effect.context<CommandExecutor.CommandExecutor>(), (context) => ({
    run: (request: CommandRequest): Effect.Effect<CommandResult, CommandError> =>
      Effect.provide(execute(request), context),
  })),
}) {}
