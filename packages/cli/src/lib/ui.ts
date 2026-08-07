import { intro, log, outro, spinner } from '@clack/prompts';
import type { Print } from '@parshjs/core';

export type Ui = {
  open: (message: string) => void;
  step: (message: string) => void;
  done: (message: string) => void;
  /**
   * The task is handed a way to rewrite the line it is waiting under, so a wait long enough to
   * look like a hung terminal can say how far along it is.
   */
  waitingFor: <T>(input: {
    message: string;
    task: (update: (message: string) => void) => Promise<T>;
  }) => Promise<T>;
};

/**
 * Both ends, because a question is only worth asking when it is written to a terminal and the
 * answer comes back from one. A pipe on either side is a script, and a script is owed the
 * defaults and plain output rather than a prompt nobody is there to read.
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function createUi({ print, interactive }: { print: Print; interactive: boolean }): Ui {
  if (interactive) {
    return {
      open: (message) => intro(message),
      step: (message) => log.step(message),
      done: (message) => outro(message),
      // Settled on the message it started with rather than the last thing progress wrote, so what
      // stays on screen is what the wait was for and not the moment it happened to end at.
      waitingFor: async ({ message, task }) => {
        const waiting = spinner();
        waiting.start(message);
        try {
          const result = await task((update) => waiting.message(update));
          waiting.stop(message);
          return result;
        } catch (failure) {
          waiting.error(message);
          throw failure;
        }
      },
    };
  }
  return {
    // Plain output has no frame to open, and a spinner drawn into a log file is noise: what a
    // reader of one wants is the line saying the wait started. Progress is dropped for the same
    // reason — a log is read after the fact, when every step of a bar has the same answer.
    open: () => {},
    step: (message) => print.dim(message),
    done: (message) => print.success(message),
    waitingFor: ({ message, task }) => {
      print.dim(message);
      return task(() => {});
    },
  };
}
