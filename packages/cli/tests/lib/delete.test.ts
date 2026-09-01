import { describe, expect, test } from 'bun:test';
import { DELETED_OUTPUT, deleteApp, saysDeletePermanently } from '#lib/delete.ts';
import {
  apiHolding,
  deploymentsHolding,
  type ListedApp,
  listedApp,
  RUNNING_DEPLOYMENT,
} from '#tests/support/api.ts';
import { APP_ID, HOSTNAME, SLUG } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';

function listed(overrides: Partial<ListedApp> = {}): ListedApp {
  return listedApp({ hostnames: [{ hostname: HOSTNAME }], ...overrides });
}

/** The apps an owner has, and the ids the run asked the api to delete. */
function apiHoldingDeletable({ apps, deleted }: { apps: ListedApp[]; deleted: string[] }) {
  return apiHolding({
    apps,
    underApp: ({ appId }) => ({
      // Read to decide what the app's state allows, which for a delete is everything up to the
      // teardown already under way.
      deployments: deploymentsHolding([RUNNING_DEPLOYMENT]),
      delete: () => {
        deleted.push(appId);
        return Promise.resolve({ data: { slug: SLUG, state: 'deleting' }, error: null });
      },
    }),
  });
}

describe('what a run with nobody watching is allowed to delete', () => {
  test('nothing, without --yes', async () => {
    const deleted: string[] = [];

    const attempt = deleteApp({
      api: apiHoldingDeletable({ apps: [listed()], deleted }),
      slug: SLUG,
      yes: false,
      interactive: false,
    });

    await expect(attempt).rejects.toThrow('Pass --yes to mean it.');
    expect(deleted).toEqual([]);
  });

  test('the app it named, with --yes', async () => {
    const deleted: string[] = [];

    await deleteApp({
      api: apiHoldingDeletable({ apps: [listed()], deleted }),
      slug: SLUG,
      yes: true,
      interactive: false,
    });

    expect(deleted).toEqual([APP_ID]);
  });
});

// The teardown already running is the answer to the second request, so it is not sent.
test('an app already being deleted is not deleted again', async () => {
  const deleted: string[] = [];

  const deleting = await deleteApp({
    api: apiHoldingDeletable({ apps: [listed({ state: 'deleting' })], deleted }),
    slug: SLUG,
    yes: true,
    interactive: false,
  });

  expect(deleted).toEqual([]);
  expect(deleting).toEqual({ slug: SLUG, state: 'deleting', changed: false });
});

test('and the teardown already under way is what a reader is told about', () => {
  const out = writerRecording();

  DELETED_OUTPUT.render({ value: { slug: SLUG, state: 'deleting', changed: false }, out });

  expect(out.said).toEqual([`${SLUG} is already being deleted.`]);
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
