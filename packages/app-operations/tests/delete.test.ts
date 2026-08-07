import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import { deleteApp } from '#delete.ts';

const SLUG = 'quiet-otter';

function apiHolding({ deleted }: { deleted: string[] }): PublicApiClient {
  function addressed({ appId }: { appId: string }) {
    return {
      delete: () => {
        deleted.push(appId);
        return Promise.resolve({ data: { slug: SLUG, state: 'deleting' }, error: null });
      },
    };
  }
  return { api: { apps: addressed } } as unknown as PublicApiClient;
}

test('the app named is the app the api is asked to tear down', async () => {
  const deleted: string[] = [];

  const deleting = await deleteApp({ api: apiHolding({ deleted }), appId: 'app-1' });

  expect(deleted).toEqual(['app-1']);
  expect(deleting).toEqual({ slug: SLUG, state: 'deleting' });
});
