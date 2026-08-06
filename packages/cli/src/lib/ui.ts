import { intro, log, outro, spinner } from '@clack/prompts';
import type { Print } from '@parshjs/core';

export type Ui = {
  open: (message: string) => void;
  step: (message: string) => void;
  done: (message: string) => void;
  waitingFor: <T>(input: { message: string; task: () => Promise<T> }) => Promise<T>;
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
      waitingFor: async ({ message, task }) => {
        const waiting = spinner();
        waiting.start(message);
        try {
          const result = await task();
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
    // reader of one wants is the line saying the wait started.
    open: () => {},
    step: (message) => print.dim(message),
    done: (message) => print.success(message),
    waitingFor: ({ message, task }) => {
      print.dim(message);
      return task();
    },
  };
}
