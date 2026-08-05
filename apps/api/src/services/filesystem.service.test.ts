import { describe, expect, test } from 'bun:test';
import type { AppId, GuestPath, Timestamp } from '@repo/protocol';
import { FilesystemRepository } from '#repositories/filesystem.repository.ts';
import { FilesystemService } from '#services/filesystem.service.ts';

const OTHER_APP = 'app-somebody-else' as AppId;

// The real repository, because the query it holds is what is under test. It reads no database,
// so the client it is handed is never touched.
const repository = new FilesystemRepository(undefined as never);

function standingQuery() {
  return repository.pendingQuery();
}

describe('a read is offered to the host that says it holds the volume', () => {
  test('a host serving the app is given the query', async () => {
    const query = await standingQuery();
    const service = new FilesystemService({ filesystemRepo: repository });

    expect(await service.pendingQuery({ servedAppIds: [query.appId] })).toEqual(query);
  });

  // Without this the first host to poll would take every tenant's read and fail all but its own.
  test('a host that does not serve it is given nothing', async () => {
    const service = new FilesystemService({ filesystemRepo: repository });

    expect(await service.pendingQuery({ servedAppIds: [OTHER_APP] })).toBeUndefined();
    expect(await service.pendingQuery({ servedAppIds: [] })).toBeUndefined();
  });

  // Nothing marks it answered, so it is handed out again on the next poll. That is what makes it
  // a standing query rather than a queue, and what has to change when a caller is waiting on one.
  test('answering it does not retire it', async () => {
    const query = await standingQuery();
    const service = new FilesystemService({ filesystemRepo: repository });

    service.acceptResult({
      queryId: query.queryId,
      outcome: {
        status: 'listed',
        listing: { path: '/' as GuestPath, entries: [], truncated: false },
      },
    });

    expect(await service.pendingQuery({ servedAppIds: [query.appId] })).toEqual(query);
  });
});

describe('a result is taken whatever it says', () => {
  test('a listing is accepted', () => {
    const service = new FilesystemService({ filesystemRepo: repository });

    expect(() =>
      service.acceptResult({
        queryId: 'query-1' as never,
        outcome: {
          status: 'listed',
          listing: {
            path: '/' as GuestPath,
            entries: [
              {
                name: 'pb_data',
                kind: 'directory',
                sizeBytes: 4096,
                modifiedAt: '2026-08-03T09:41:00Z' as Timestamp,
              },
            ],
            truncated: false,
          },
        },
      }),
    ).not.toThrow();
  });

  test('so is a failure, which is the answer that says the host tried', () => {
    const service = new FilesystemService({ filesystemRepo: repository });

    expect(() =>
      service.acceptResult({
        queryId: 'query-1' as never,
        outcome: { status: 'failed', message: 'no device is attached on this host' },
      }),
    ).not.toThrow();
  });
});
