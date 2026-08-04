import type { PlatformError } from '@effect/platform/Error';
import { Data, type Duration } from 'effect';

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
}> {
  /** The tail of stderr: the head of a long one is a banner, and the reason is at the end. */
  override get message() {
    const reason = this.result.stderr.trim().split('\n').at(-1) ?? '';
    return `${this.command[0]} exited ${this.result.code}${reason ? `: ${reason}` : ''}`;
  }
}

export class CommandTimedOut extends Data.TaggedError('CommandTimedOut')<{
  readonly command: CommandLine;
}> {
  override get message() {
    return `${this.command[0]} did not finish in time`;
  }
}

export type CommandError = CommandFailed | CommandTimedOut | PlatformError;
