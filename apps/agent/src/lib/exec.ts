import { Command, CommandExecutor } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Context, Data, Duration, Effect, Layer, Stream } from 'effect';

const DEFAULT_TIMEOUT = Duration.minutes(2);
const SUCCESS = 0;

export type CommandLine = readonly [string, ...string[]];

export type CommandRequest = {
  readonly command: CommandLine;
  readonly stdin?: string;
  readonly timeout?: Duration.DurationInput;
};

export type CommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class CommandFailed extends Data.TaggedError('CommandFailed')<{
  readonly command: CommandLine;
  readonly result: CommandResult;
}> {}

export class CommandTimedOut extends Data.TaggedError('CommandTimedOut')<{
  readonly command: CommandLine;
}> {}

export type CommandError = CommandFailed | CommandTimedOut | PlatformError;

export class CommandRunner extends Context.Tag('CommandRunner')<
  CommandRunner,
  { readonly run: (request: CommandRequest) => Effect.Effect<CommandResult, CommandError> }
>() {}

export const run = (request: CommandRequest) =>
  Effect.flatMap(CommandRunner, (runner) => runner.run(request));

export const stdoutOf = (request: CommandRequest) =>
  Effect.flatMap(run(request), (result) =>
    result.code === SUCCESS
      ? Effect.succeed(result.stdout)
      : new CommandFailed({ command: request.command, result }),
  );

const build = ({ command: [executable, ...args], stdin }: CommandRequest) => {
  const command = Command.make(executable, ...args);
  return stdin === undefined ? command : Command.feed(command, stdin);
};

const collect = (stream: Stream.Stream<Uint8Array, PlatformError>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold('', (all, chunk) => all + chunk),
  );

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
  );

export const layer = Layer.effect(
  CommandRunner,
  Effect.map(Effect.context<CommandExecutor.CommandExecutor>(), (context) => ({
    run: (request: CommandRequest) => Effect.provide(execute(request), context),
  })),
);
