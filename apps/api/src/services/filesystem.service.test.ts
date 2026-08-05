import { describe, expect, test } from 'bun:test';
import type { AppId, GuestPath, Timestamp } from '@repo/protocol';
import { FilesystemRepository } from '#repositories/filesystem.repository.ts';
import { FilesystemService } from '#services/filesystem.service.ts';

const OTHER_APP = 'app-somebody-else' as AppId;

// The real repository, because the query it holds is what is under test. It reads no database,
// so the client it is handed is never touched.
const repository = new FilesystemRepository(undefined as never);

function standingQueries() {
  return repository.pendingQueries();
}

async function servedApps() {
  return [...new Set((await standingQueries()).map((query) => query.appId))];
}

/** What a host polling `pollCount` times in a row would be told to read, in order. */
async function pathsOverPolls(pollCount: number) {
  const service = new FilesystemService({ filesystemRepo: repository });
  const servedAppIds = await servedApps();
  const paths: (string | undefined)[] = [];
  for (let poll = 0; poll < pollCount; poll += 1) {
    paths.push((await service.pendingQuery({ servedAppIds }))?.path);
  }
  return paths;
}

describe('a read is offered to the host that says it holds the volume', () => {
  test('a host serving the app is given a query', async () => {
    const service = new FilesystemService({ filesystemRepo: repository });

    expect(await service.pendingQuery({ servedAppIds: await servedApps() })).toBeDefined();
  });

  // Without this the first host to poll would take every tenant's read and fail all but its own.
  test('a host that does not serve it is given nothing', async () => {
    const service = new FilesystemService({ filesystemRepo: repository });

    expect(await service.pendingQuery({ servedAppIds: [OTHER_APP] })).toBeUndefined();
    expect(await service.pendingQuery({ servedAppIds: [] })).toBeUndefined();
  });

  // The root proves a device can be read and then never changes again, so a rotation that
  // starved the directory the tenant writes to would look alive while saying nothing.
  test('every standing query comes round, and in turn', async () => {
    const queries = await standingQueries();
    const seen = await pathsOverPolls(queries.length * 2);

    expect(seen.slice(0, queries.length)).toEqual(queries.map((query) => query.path));
    expect(seen.slice(queries.length)).toEqual(queries.map((query) => query.path));
  });

  test('and one of them is the directory the tenant binary writes to', async () => {
    expect((await standingQueries()).map((query) => query.path)).toContain('/pb_data' as GuestPath);
  });

  // Nothing marks one answered, so it comes round again. That is what makes these standing
  // queries rather than a queue, and what has to change when a caller is waiting on one.
  test('answering one does not retire it', async () => {
    const queries = await standingQueries();
    const service = new FilesystemService({ filesystemRepo: repository });
    const first = await service.pendingQuery({ servedAppIds: await servedApps() });

    service.acceptResult({
      queryId: first?.queryId ?? ('unknown' as never),
      outcome: {
        status: 'listed',
        listing: { path: '/' as GuestPath, entries: [], truncated: false },
      },
    });

    const seen = await pathsOverPolls(queries.length);
    expect(seen).toContain(first?.path);
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
