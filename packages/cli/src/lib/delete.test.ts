import { describe, expect, test } from 'bun:test';
import type { Api } from '#lib/api.ts';
import { deleteApp, saysDeletePermanently } from '#lib/delete.ts';
import type { Ui } from '#lib/ui.ts';

const SLUG = 'quiet-otter';

type Listed = { id: string; slug: string; state: string; hostnames: Array<{ hostname: string }> };

function listed(overrides: Partial<Listed> = {}): Listed {
  return {
    id: 'app-1',
    slug: SLUG,
    state: 'active',
    hostnames: [{ hostname: `${SLUG}.nibrun.app` }],
    ...overrides,
  };
}

/** The apps an owner has, and the ids the run asked the api to delete. */
function apiHolding({ apps, deleted }: { apps: Listed[]; deleted: string[] }): Api {
  function addressed({ appId }: { appId: string }) {
    return {
      delete: () => {
        deleted.push(appId);
        return Promise.resolve({ data: { slug: SLUG, state: 'deleting' }, error: null });
      },
    };
  }
  // Eden spells a path segment and its parameter as the same name, so the listing hangs off the
  // function that addresses one app.
  const route = Object.assign(addressed, {
    get: () => Promise.resolve({ data: { apps }, error: null }),
  });
  return { api: { apps: route } } as unknown as Api;
}

function ui(): Ui & { said: string[] } {
  const said: string[] = [];
  return {
    said,
    open: () => {},
    step: (message) => said.push(message),
    done: (message) => said.push(message),
    waitingFor: ({ task }) => task(),
  };
}

describe('what a run with nobody watching is allowed to delete', () => {
  test('nothing, without --yes', async () => {
    const deleted: string[] = [];

    const attempt = deleteApp({
      api: apiHolding({ apps: [listed()], deleted }),
      slug: SLUG,
      ui: ui(),
      yes: false,
      interactive: false,
    });

    await expect(attempt).rejects.toThrow('Pass --yes to mean it.');
    expect(deleted).toEqual([]);
  });

  test('the app it named, with --yes', async () => {
    const deleted: string[] = [];

    await deleteApp({
      api: apiHolding({ apps: [listed()], deleted }),
      slug: SLUG,
      ui: ui(),
      yes: true,
      interactive: false,
    });

    expect(deleted).toEqual(['app-1']);
  });
});

// The teardown already running is the answer to the second request, so it is not sent.
test('an app already being deleted is not deleted again', async () => {
  const deleted: string[] = [];
  const said = ui();

  await deleteApp({
    api: apiHolding({ apps: [listed({ state: 'deleting' })], deleted }),
    slug: SLUG,
    ui: said,
    yes: true,
    interactive: false,
  });

  expect(deleted).toEqual([]);
  expect(said.said).toEqual([`${SLUG} is already being deleted.`]);
});

describe('what counts as having typed the phrase', () => {
  test('the phrase itself does', () => {
    expect(saysDeletePermanently('delete permanently')).toBe(true);
  });

  test('a caps lock left on is not a second chance to think about it', () => {
    expect(saysDeletePermanently('DELETE PERMANENTLY')).toBe(true);
  });

  test('a space either side of it is not what was being asked', () => {
    expect(saysDeletePermanently('  delete permanently  ')).toBe(true);
  });
});

describe('what a y/n would have accepted and this does not', () => {
  test('the answer to a different question', () => {
    expect(saysDeletePermanently('y')).toBe(false);
  });

  test('half the phrase', () => {
    expect(saysDeletePermanently('delete')).toBe(false);
  });

  test('the slug of the app being deleted', () => {
    expect(saysDeletePermanently(SLUG)).toBe(false);
  });

  test('a return pressed on an empty line', () => {
    expect(saysDeletePermanently('')).toBe(false);
  });

  test('nothing typed at all', () => {
    expect(saysDeletePermanently(undefined)).toBe(false);
  });
});
