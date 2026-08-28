import { describe, expect, test } from 'bun:test';
import { type AppListing, render } from '#lib/app-list.ts';

const VOLUME_SIZE_BYTES = 8_589_934_592;
const MEASURED_SHARE = 0.17;
const MEASURED_PERCENT = '17%';

// Plain strings rather than the branded ones the wire carries: what is pinned down here is how a
// row is laid out, and a cast per field would be spelling rather than meaning.
function app(overrides: Partial<Record<keyof AppListing, unknown>> = {}): AppListing {
  return {
    slug: 'quiet-otter',
    state: 'active',
    updatedAt: '2026-08-07T09:41:00.123Z',
    config: { volumeSizeBytes: VOLUME_SIZE_BYTES },
    volumeUsage: null,
    ...overrides,
  } as AppListing;
}

function used(share: number) {
  return {
    totalBytes: VOLUME_SIZE_BYTES,
    usedBytes: VOLUME_SIZE_BYTES * share,
    measuredAt: '2026-08-07T09:40:00.000Z',
  };
}

describe('a listing is read down a column', () => {
  test('a heading says what each column is', () => {
    expect(render([app()])).toEqual([
      'SLUG         STATE      VOLUME  LAST CHANGE',
      'quiet-otter  active          -  2026-08-07 09:41',
    ]);
  });

  test('the widest slug is what the column is wide enough for', () => {
    expect(render([app({ slug: 'a' }), app({ slug: 'considerably-longer' })])).toEqual([
      'SLUG                 STATE      VOLUME  LAST CHANGE',
      'a                    active          -  2026-08-07 09:41',
      'considerably-longer  active          -  2026-08-07 09:41',
    ]);
  });

  // The column is sized for every state an app can be in, so reading two listings side by side is
  // reading the same shape twice.
  test('a state wider than the one beside it does not shift the columns', () => {
    expect(render([app({ state: 'suspended' }), app({ state: 'deleting' })])).toEqual([
      'SLUG         STATE      VOLUME  LAST CHANGE',
      'quiet-otter  suspended       -  2026-08-07 09:41',
      'quiet-otter  deleting        -  2026-08-07 09:41',
    ]);
  });

  test('the day is said as well as the minute, because an app may not have changed today', () => {
    const lines = render([app({ updatedAt: '2026-01-02T23:05:59.999Z' })]);

    expect(lines.at(-1)).toEndWith('2026-01-02 23:05');
  });
});

describe('the volume column says how full the filesystem is', () => {
  test('a measured app shows what share of its volume it is using', () => {
    expect(render([app({ volumeUsage: used(MEASURED_SHARE) })]).at(-1)).toContain(MEASURED_PERCENT);
  });

  // A reading is only taken while a guest has the filesystem mounted, so an app that has never
  // come up has none — which is a different thing from one measured at nothing.
  test('an app nothing has measured says so rather than reading as empty', () => {
    expect(render([app()]).at(-1)).toContain('   -  ');
  });
});

// Newest first is the api's answer, and the order an owner made their apps in is the one they
// remember them in.
test('the order the api answered with is the order that is printed', () => {
  const lines = render([app({ slug: 'newest' }), app({ slug: 'oldest' })]);

  expect(lines.map((line) => line.split(' ')[0])).toEqual(['SLUG', 'newest', 'oldest']);
});
