import { BunContext } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import {
  type CommandError,
  type CommandRequest,
  type CommandResult,
  CommandRunner,
} from '#lib/exec.ts';

const OK: CommandResult = { code: 0, stdout: '', stderr: '' };

/** Records every command and answers each one, so a call shape can be asserted without a host. */
export function recordingCommands(
  answer: (request: CommandRequest) => Effect.Effect<CommandResult, CommandError> = () =>
    Effect.succeed(OK),
) {
  const commands: CommandRequest[] = [];
  const layer = Layer.succeed(CommandRunner, {
    run: (request) => {
      commands.push(request);
      return answer(request);
    },
  });
  return { commands, layer, executables: () => commands.map(({ command }) => command[0]) };
}

export const platform = BunContext.layer;

export const succeeding = (result: Partial<CommandResult> = {}) =>
  Effect.succeed({ ...OK, ...result });
