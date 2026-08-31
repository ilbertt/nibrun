import type { Print } from '@parshjs/core';
import type { z } from 'zod';
import { createUi, isInteractive, type Ui } from '#lib/ui.ts';

/**
 * Where a rendered answer lands: `print` for the body of it, `step` and `done` for the lines that
 * fill in and close the frame an interactive flow opened.
 */
export type Writer = Print & Pick<Ui, 'step' | 'done'>;

/**
 * What a command answers with, said once.
 *
 * The schema is the contract `--json` prints against, and the renderer is that same value read by
 * a person — handed nothing else, so a field cannot reach one surface and be missing from the
 * other. Adding something to what a command says is adding it to the schema, and the renderer is
 * where that is turned back into a sentence.
 *
 * Declared beside the code that produces the value rather than in the command, so the two
 * spellings of `apps files ls` share one, and so the layout helpers stay testable on their own.
 */
export type Output<Schema extends z.ZodType> = {
  schema: Schema;
  render: (answer: { value: z.output<Schema>; out: Writer }) => void;
};

export function defineOutput<Schema extends z.ZodType>(output: Output<Schema>): Output<Schema> {
  return output;
}

/**
 * Progress written while `--json` is on. stdout carries the answer and nothing but the answer, so
 * everything said to whoever is watching goes to stderr instead — which is what keeps a command
 * that has something to show mid-flight usable, `nib login` and the code it prints above all.
 */
const ASIDE: Print = {
  info: aside,
  success: aside,
  warn: aside,
  error: aside,
  dim: aside,
};

function aside(message: string): void {
  process.stderr.write(`${message}\n`);
}

export type Emitting<Schema extends z.ZodType> = {
  /**
   * Whether there is anybody to put a question to. `--json` answers that on its own: a caller
   * reading the output with a program is not sat at the prompt a question would be asked at.
   */
  interactive: boolean;
  ui: Ui;
  /**
   * Anything said beside the answer rather than as part of it — which release is being read, what
   * a wait is for. The same `print` a handler was given, until `--json` moves it off stdout.
   */
  aside: Print;
  /** Called once by most commands, and once per record by the ones that follow something. */
  emit: (value: z.input<Schema>) => void;
};

export function createOutput<Schema extends z.ZodType>({
  output,
  print,
  json,
}: {
  output: Output<Schema>;
  print: Print;
  json: boolean;
}): Emitting<Schema> {
  const interactive = !json && isInteractive();
  const commentary = json ? ASIDE : print;
  const ui = createUi({ print: commentary, interactive });

  return {
    interactive,
    ui,
    aside: commentary,
    emit: (value) => {
      // Parsed rather than passed through: the schema is what the JSON promises, so it is what
      // decides which fields either surface gets to see.
      const answer = output.schema.parse(value);
      if (json) {
        // One line per value, so a command that answers once and a command that follows a stream
        // are read by the same reader.
        process.stdout.write(`${JSON.stringify(answer)}\n`);
        return;
      }
      output.render({ value: answer, out: { ...print, step: ui.step, done: ui.done } });
    },
  };
}
