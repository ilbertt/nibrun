import { mock } from 'bun:test';

type Option = { value: string; label: string; hint?: string | undefined };

export type Question =
  | { kind: 'select'; message: string; options: Option[] }
  | { kind: 'text'; message: string; initialValue: string | undefined }
  | { kind: 'confirm'; message: string };

export type Prompts = {
  asked: Question[];
  notes: string[];
  /** What the owner at the terminal answers with, for a test to set before it runs a command. */
  answers: { chosen: unknown; confirmed: boolean };
  reset: () => void;
  /** The questions as one line each, for asserting on an exchange rather than a single question. */
  transcript: () => string[];
};

function spell(question: Question): string {
  if (question.kind === 'select') {
    const labels = question.options.map((option) => option.label).join('|');
    return `select:${question.message} [${labels}]`;
  }
  if (question.kind === 'text') {
    return `text:${question.message} (${question.initialValue})`;
  }
  return `confirm:${question.message}`;
}

/**
 * Clack replaced wholesale rather than reached through a port: what these tests pin down is which
 * question an owner is asked, what it offers them and in what order, and a port would only let a
 * command answer that about itself.
 *
 * `mock.module` is global and outlives the file that installs it, so the rest of clack is spread
 * back in — a stub carrying only what one command asks for leaves whichever file runs next unable
 * to import the rest.
 */
export async function recordingPrompts(): Promise<Prompts> {
  const clack = await import('@clack/prompts');

  const asked: Question[] = [];
  const notes: string[] = [];
  const answers: Prompts['answers'] = { chosen: null, confirmed: true };

  mock.module('@clack/prompts', () => ({
    ...clack,
    isCancel: (value: unknown) => typeof value === 'symbol',
    select({ message, options }: { message: string; options: Option[] }) {
      asked.push({ kind: 'select', message, options });
      return Promise.resolve(answers.chosen);
    },
    text({ message, initialValue }: { message: string; initialValue?: string }) {
      asked.push({ kind: 'text', message, initialValue });
      return Promise.resolve(initialValue);
    },
    confirm({ message }: { message: string }) {
      asked.push({ kind: 'confirm', message });
      return Promise.resolve(answers.confirmed);
    },
    // biome-ignore lint/complexity/useMaxParams: mirrors clack's own (message, title) signature
    note(message: string, title: string) {
      notes.push(`${title}\n${message}`);
    },
  }));

  return {
    asked,
    notes,
    answers,
    reset() {
      asked.length = 0;
      notes.length = 0;
      answers.chosen = null;
      answers.confirmed = true;
    },
    transcript: () => asked.map(spell),
  };
}
