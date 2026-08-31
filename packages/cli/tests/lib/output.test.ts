import { describe, expect, test } from 'bun:test';
import type { Print } from '@parshjs/core';
import { z } from 'zod';
import { createOutput, defineOutput } from '#lib/output.ts';
import { SLUG } from '#tests/support/app.ts';

const rendered: string[] = [];

const OUTPUT = defineOutput({
  schema: z.object({ slug: z.string() }),
  render: ({ value }) => {
    rendered.push(value.slug);
  },
});

function silent(): Print {
  return { info: () => {}, success: () => {}, warn: () => {}, error: () => {}, dim: () => {} };
}

type Write = typeof process.stdout.write;

/** What a run put on each of this program's own streams, which is the whole point of `--json`. */
function captured(run: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;

  process.stdout.write = ((chunk: unknown) => out.push(String(chunk)) > 0) as Write;
  process.stderr.write = ((chunk: unknown) => err.push(String(chunk)) > 0) as Write;
  try {
    run();
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
  return { out, err };
}

function answering({ json }: { json: boolean }) {
  rendered.length = 0;
  return createOutput({ output: OUTPUT, print: silent(), json });
}

describe('the same answer reaches either surface, and only one of them at a time', () => {
  test('--json is one line of it, and the renderer never runs', () => {
    const { emit } = answering({ json: true });

    const { out } = captured(() => emit({ slug: SLUG }));

    expect(out).toEqual([`{"slug":"${SLUG}"}\n`]);
    expect(rendered).toEqual([]);
  });

  test('without it the renderer is what says anything at all', () => {
    const { emit } = answering({ json: false });

    const { out } = captured(() => emit({ slug: SLUG }));

    expect(rendered).toEqual([SLUG]);
    expect(out).toEqual([]);
  });

  // One line per value rather than one document, so a command that answers once and a command
  // that follows a stream are read by the same reader.
  test('a command that answers more than once answers a line at a time', () => {
    const { emit } = answering({ json: true });

    const { out } = captured(() => {
      emit({ slug: 'first' });
      emit({ slug: 'second' });
    });

    expect(out).toEqual(['{"slug":"first"}\n', '{"slug":"second"}\n']);
  });
});

// The schema is what the JSON promises, so it is what decides which fields go out — not whatever
// the api happened to hand the command on the way past.
test('a field the schema does not name does not reach the output', () => {
  const { emit } = answering({ json: true });

  const { out } = captured(() => emit({ slug: SLUG, accessToken: 'shh' } as { slug: string }));

  expect(out).toEqual([`{"slug":"${SLUG}"}\n`]);
});

describe('what --json does to everything that is not the answer', () => {
  test('progress goes to stderr, so nothing said in passing corrupts the payload', () => {
    const { aside } = answering({ json: true });

    const { out, err } = captured(() => aside.dim('uploading'));

    expect(out).toEqual([]);
    expect(err).toEqual(['uploading\n']);
  });

  // A caller reading this with a program is not sat at the prompt a question would be asked at.
  test('it is not a terminal to ask a question at', () => {
    expect(answering({ json: true }).interactive).toBe(false);
  });
});
