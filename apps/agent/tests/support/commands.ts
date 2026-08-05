import { Effect, Layer } from 'effect';
import type { CommandError, CommandRequest, CommandResult } from '#lib/exec.ts';
import { CommandRunner } from '#services/command-runner.service.ts';

const OK: CommandResult = { code: 0, stdout: '', stderr: '' };

export function succeeding(result: Partial<CommandResult> = {}) {
  return Effect.succeed({ ...OK, ...result });
}

/** Records every command and answers each one, so a call shape can be asserted without a host. */
export function recordingCommands(
  answer: (request: CommandRequest) => Effect.Effect<CommandResult, CommandError> = () =>
    succeeding(),
) {
  const commands: CommandRequest[] = [];
  const layer = Layer.succeed(
    CommandRunner,
    CommandRunner.make({
      run: (request) => {
        commands.push(request);
        return answer(request);
      },
    }),
  );
  return { commands, layer, executables: () => commands.map(({ command }) => command[0]) };
}
