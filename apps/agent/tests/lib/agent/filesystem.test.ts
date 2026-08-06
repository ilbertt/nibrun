import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  type DirectoryListing,
  type FilesystemQuery,
  FilesystemQueryIdSchema,
  GuestPathSchema,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { answer } from '#lib/agent/filesystem.ts';
import { UnreadableDirectory } from '#lib/filesystem/debugfs.ts';
import { FilesystemReader, NoDeviceForApp } from '#services/filesystem-reader.service.ts';
import { recordingCommands } from '#tests/support/commands.ts';

const APP = Value.Parse(AppIdSchema, 'app-pocketbase');
const QUERY: FilesystemQuery = {
  queryId: Value.Parse(FilesystemQueryIdSchema, 'query-1'),
  appId: APP,
  path: Value.Parse(GuestPathSchema, '/'),
};

const LISTING: DirectoryListing = {
  path: Value.Parse(GuestPathSchema, '/'),
  entries: [
    {
      name: 'pb_data',
      kind: 'directory',
      sizeBytes: 4096,
      modifiedAt: Value.Parse(TimestampSchema, '2026-08-03T09:41:00Z'),
    },
  ],
  truncated: false,
};

/**
 * `CommandRunner` comes along because a real read shells out, and the stub keeps its signature.
 * Nothing here reaches it — a test that ran a subprocess would be testing the host, not this.
 */
function answering(list: FilesystemReader['list']) {
  const layer = Layer.merge(
    Layer.succeed(FilesystemReader, FilesystemReader.make({ list })),
    recordingCommands().layer,
  );
  return Effect.runPromise(Effect.provide(answer(QUERY), layer));
}

// Somebody is holding a request open on the other end of this, so silence is the one outcome
// that helps nobody: it turns a refusal they could act on into a timeout they cannot.
describe('a query is answered whatever the read did', () => {
  test('a directory that was read comes back as it was read', async () => {
    const result = await answering(() => Effect.succeed(LISTING));

    expect(result).toEqual({
      queryId: QUERY.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });
  });

  test('a device this host does not hold is still an answer', async () => {
    const result = await answering(() => new NoDeviceForApp({ appId: APP }));

    expect(result.queryId).toBe(QUERY.queryId);
    expect(result.outcome.status).toBe('failed');
  });

  test('a device that could not be read is too', async () => {
    const result = await answering(() => new UnreadableDirectory({ devicePath: '/dev/nbd7' }));

    expect(result.outcome.status).toBe('failed');
  });

  // The message reaches whoever asked, so it has to read as a sentence rather than as a tag —
  // and it must not carry the path, which is the tenant's to know.
  test('a failure explains itself without quoting what was asked for', async () => {
    const result = await answering(() => new UnreadableDirectory({ devicePath: '/dev/nbd7' }));

    if (result.outcome.status !== 'failed') {
      throw new Error('a failed read must answer with a failure');
    }
    expect(result.outcome.message).toContain('/dev/nbd7');
    expect(result.outcome.message).not.toContain('UnreadableDirectory');
  });
});
