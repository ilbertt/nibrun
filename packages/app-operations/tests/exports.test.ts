import { expect, test } from 'bun:test';
import type { PublicApiClient } from '@repo/api-client/public';
import { awaitExportBundle, requestExport } from '#exports.ts';

const APP_ID = 'app-1';
const EXPORT_ID = 'export-1';
const DOWNLOAD_URL = 'https://bundles.example/export-1?signature=x';
const SIZE_BYTES = 4096;

type Found = { state: string; downloadUrl?: string; sizeBytes?: number };

function apiHolding({ found, asked }: { found: Found; asked?: string[] }): PublicApiClient {
  function underApp({ appId }: { appId: string }) {
    function addressed({ exportId }: { exportId: string }) {
      return {
        get: () => {
          asked?.push(exportId);
          return Promise.resolve({ data: { id: exportId, ...found }, error: null });
        },
      };
    }
    return {
      exports: Object.assign(addressed, {
        post: () => {
          asked?.push(appId);
          return Promise.resolve({ data: { id: EXPORT_ID, state: 'pending' }, error: null });
        },
      }),
    };
  }

  return { api: { apps: underApp } } as unknown as PublicApiClient;
}

test('the app an export is asked for is the app it is asked under', async () => {
  const asked: string[] = [];

  const requested = await requestExport({
    api: apiHolding({ found: { state: 'pending' }, asked }),
    appId: APP_ID,
  });

  expect(asked).toEqual([APP_ID]);
  expect(requested).toMatchObject({ id: EXPORT_ID, state: 'pending' });
});

// The url is signed for the response it arrives in, so it is what says the bundle is there.
test('a download url is what the wait is waiting for', async () => {
  const api = apiHolding({
    found: { state: 'ready', downloadUrl: DOWNLOAD_URL, sizeBytes: SIZE_BYTES },
  });

  await expect(awaitExportBundle({ api, appId: APP_ID, exportId: EXPORT_ID })).resolves.toEqual({
    downloadUrl: DOWNLOAD_URL,
    sizeBytes: SIZE_BYTES,
  });
});

test('a size the host did not report is not waited for either', async () => {
  const api = apiHolding({ found: { state: 'ready', downloadUrl: DOWNLOAD_URL } });

  await expect(awaitExportBundle({ api, appId: APP_ID, exportId: EXPORT_ID })).resolves.toEqual({
    downloadUrl: DOWNLOAD_URL,
    sizeBytes: undefined,
  });
});

test('an export that will never arrive is said rather than waited on', async () => {
  const api = apiHolding({ found: { state: 'failed' } });

  await expect(awaitExportBundle({ api, appId: APP_ID, exportId: EXPORT_ID })).rejects.toThrow(
    `Export ${EXPORT_ID} is failed.`,
  );
});
