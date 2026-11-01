import { type AppId, DirectoryListingSchema, type GuestPath, parseMessage } from '@repo/protocol';
import { Data, Effect } from 'effect';
import type { DirectoryListing } from '#lib/nibrunner/filesystem.gen.ts';
import { NIBRUNNER_DATA_DIRECTORY } from '#lib/nibrunner/paths.ts';
import { decode } from '#lib/protocol.ts';

const RESPONSE_TIMEOUT = '15 seconds';
const MAX_RESPONSE_BYTES = 1_048_576;

export class NibrunnerFilesystemUnavailable extends Data.TaggedError(
  'NibrunnerFilesystemUnavailable',
) {
  override get message() {
    return 'The app filesystem could not be read.';
  }
}

async function listingBody(response: Response) {
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new NibrunnerFilesystemUnavailable();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new NibrunnerFilesystemUnavailable();
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    await reader.cancel();
  }
}

export function makeNibrunnerFilesystem({ socketPath }: { socketPath: string }) {
  return {
    list: ({ appId, path }: { appId: AppId; path: GuestPath }) =>
      Effect.gen(function* () {
        const nativePath = `${NIBRUNNER_DATA_DIRECTORY}${path === '/' ? '' : path}`;
        const url = new URL(`http://localhost/apps/${encodeURIComponent(appId)}/files`);
        url.searchParams.set('path', nativePath);
        const listing: DirectoryListing = yield* Effect.tryPromise({
          try: (signal) => fetch(url, { unix: socketPath, signal }).then(listingBody),
          catch: () => new NibrunnerFilesystemUnavailable(),
        }).pipe(
          Effect.timeoutFail({
            duration: RESPONSE_TIMEOUT,
            onTimeout: () => new NibrunnerFilesystemUnavailable(),
          }),
        );
        return yield* decode(function decodeListing() {
          if (listing.path !== nativePath) {
            throw new NibrunnerFilesystemUnavailable();
          }
          return parseMessage({ schema: DirectoryListingSchema, value: { ...listing, path } });
        });
      }),
  };
}
