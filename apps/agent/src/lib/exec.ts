const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type CommandRequest = {
  command: readonly string[];
  stdin?: string;
  timeoutMs?: number;
};

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export class CommandFailedError extends Error {
  readonly command: readonly string[];
  readonly result: CommandResult;

  constructor({ command, result }: { command: readonly string[]; result: CommandResult }) {
    const detail = result.stderr.trim() || result.stdout.trim();
    super(`${command.join(' ')} exited ${result.code}${detail ? `: ${detail}` : ''}`);
    this.name = 'CommandFailedError';
    this.command = command;
    this.result = result;
  }
}

export const runCommand: CommandRunner = async ({ command, stdin, timeoutMs }) => {
  const child = Bun.spawn({
    cmd: [...command],
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
};

export async function runCommandOrThrow({
  runner,
  request,
}: {
  runner: CommandRunner;
  request: CommandRequest;
}): Promise<string> {
  const result = await runner(request);
  if (result.code !== 0) {
    throw new CommandFailedError({ command: request.command, result });
  }
  return result.stdout;
}
