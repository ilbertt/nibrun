import { expect, test } from 'bun:test';
import { deleteApp } from '#delete.ts';
import { answering, apiHolding as apiWith } from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';

function apiHolding({ deleted }: { deleted: string[] }) {
  return apiWith({
    underApp: ({ appId }) => ({
      delete: () => {
        deleted.push(appId);
        return answering({ slug: SLUG, state: 'deleting' })();
      },
    }),
  });
}

test('the app named is the app the api is asked to tear down', async () => {
  const deleted: string[] = [];

  const deleting = await deleteApp({ api: apiHolding({ deleted }), appId: APP_ID });

  expect(deleted).toEqual([APP_ID]);
  expect(deleting).toEqual({ slug: SLUG, state: 'deleting' });
});
