import { describe, expect, test } from 'bun:test';
import { APP_LIST_OUTPUT, type AppRow, render } from '#lib/app-list.ts';
import { BYTES_PER_MIB, MEMORY_MIB, SLUG, VOLUME_SIZE_BYTES } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';

const MEASURED_SHARE = 0.17;
const MEASURED_PERCENT = '17%';
const CPU_SHARE = 0.42;
const CPU_PERCENT = '42%';
const MEMORY_SHARE = 0.5;
const MEMORY_PERCENT = '50%';

const MEMORY_BYTES = MEMORY_MIB * BYTES_PER_MIB;

function app(overrides: Partial<AppRow> = {}): AppRow {
  return {
    slug: SLUG,
    state: 'active',
    updatedAt: '2026-08-07T09:41:00.123Z',
    cpuShare: null,
    memory: { usedBytes: null, totalBytes: MEMORY_BYTES },
    volume: { usedBytes: null, totalBytes: VOLUME_SIZE_BYTES },
    ...overrides,
  };
}

function used({ share, of }: { share: number; of: number }) {
  return { usedBytes: of * share, totalBytes: of };
}

describe('a listing is read down a column', () => {
  test('a heading says what each column is', () => {
    expect(render([app()])).toEqual([
      'SLUG         STATE       CPU   MEM  VOLUME  LAST CHANGE',
      'quiet-otter  active        -     -       -  2026-08-07 09:41',
    ]);
  });

  test('the widest slug is what the column is wide enough for', () => {
    expect(render([app({ slug: 'a' }), app({ slug: 'considerably-longer' })])).toEqual([
      'SLUG                 STATE       CPU   MEM  VOLUME  LAST CHANGE',
      'a                    active        -     -       -  2026-08-07 09:41',
      'considerably-longer  active        -     -       -  2026-08-07 09:41',
    ]);
  });

  // The column is sized for every state an app can be in, so reading two listings side by side is
  // reading the same shape twice.
  test('a state wider than the one beside it does not shift the columns', () => {
    expect(render([app({ state: 'suspended' }), app({ state: 'deleting' })])).toEqual([
      'SLUG         STATE       CPU   MEM  VOLUME  LAST CHANGE',
      'quiet-otter  suspended     -     -       -  2026-08-07 09:41',
      'quiet-otter  deleting      -     -       -  2026-08-07 09:41',
    ]);
  });

  test('the day is said as well as the minute, because an app may not have changed today', () => {
    const lines = render([app({ updatedAt: '2026-01-02T23:05:59.999Z' })]);

    expect(lines.at(-1)).toEndWith('2026-01-02 23:05');
  });
});

describe('the share columns say what an app is using of what it was given', () => {
  test('a measured app shows what share of its volume it is using', () => {
    const line = render([
      app({ volume: used({ share: MEASURED_SHARE, of: VOLUME_SIZE_BYTES }) }),
    ]).at(-1);

    expect(line).toContain(MEASURED_PERCENT);
  });

  test('a measured guest shows what share of its cpu and memory it is using', () => {
    const line = render([
      app({
        cpuShare: CPU_SHARE,
        memory: used({ share: MEMORY_SHARE, of: MEMORY_BYTES }),
      }),
    ]).at(-1);

    expect(line).toContain(CPU_PERCENT);
    expect(line).toContain(MEMORY_PERCENT);
  });

  // A share is a rate, so the first reading taken of a guest has none — while the memory beside
  // it is a level and arrives whole. One column empty must not empty the other.
  test('a guest measured before it had a rate still shows its memory', () => {
    const line = render([app({ memory: used({ share: MEMORY_SHARE, of: MEMORY_BYTES }) })]).at(-1);

    expect(line).toContain(MEMORY_PERCENT);
    expect(line).toContain(`-   ${MEMORY_PERCENT}`);
  });

  // A reading is only taken while a guest is running, so an app that has never come up has none —
  // which is a different thing from one measured at nothing.
  test('an app nothing has measured says so rather than reading as empty', () => {
    expect(render([app()]).at(-1)).toContain('-     -       -');
  });
});

// Newest first is the api's answer, and the order an owner made their apps in is the one they
// remember them in.
test('the order the api answered with is the order that is printed', () => {
  const lines = render([app({ slug: 'newest' }), app({ slug: 'oldest' })]);

  expect(lines.map((line) => line.split(' ')[0])).toEqual(['SLUG', 'newest', 'oldest']);
});

// A heading over nothing reads as a listing that failed rather than an account with nothing in it.
test('an owner with no apps is told what makes one instead of shown a heading', () => {
  const out = writerRecording();

  APP_LIST_OUTPUT.render({ value: { apps: [] }, out });

  expect(out.at).toEqual(['dim']);
  expect(out.said[0]).toContain('`nib run`');
});
