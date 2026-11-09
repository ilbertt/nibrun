import type { AppId, HostId } from '@repo/protocol';
import { Effect, Ref } from 'effect';
import type { TenantLogEvent } from '#lib/logs/event.ts';
import type { LogStoreClient } from '#lib/logs/store-client.ts';
import type { NibrunnerLogPosition } from '#lib/nibrunner/log-cursors.ts';
import { InvalidNibrunnerLog, nibrunnerLogEvent } from '#lib/nibrunner/log-event.ts';
import {
  MAX_NIBRUNNER_LOG_READ_BYTES,
  type NibrunnerLogChunk,
  readNibrunnerLogChunk,
} from '#lib/nibrunner/log-reader.ts';
import type { NibrunnerLogCursors } from '#services/nibrunner-log-cursors.service.ts';

function decodeChunk({
  chunk,
  appId,
  hostId,
}: {
  chunk: NibrunnerLogChunk;
  appId: AppId;
  hostId: HostId;
}) {
  return Effect.gen(function* () {
    const events: TenantLogEvent[] = [];
    let rejected = 0;
    for (const line of chunk.lines) {
      const decoded = yield* Effect.try({
        try: () => JSON.parse(line),
        catch: () => new InvalidNibrunnerLog(),
      }).pipe(
        Effect.flatMap((value) => nibrunnerLogEvent({ value, appId, hostId })),
        Effect.either,
      );
      if (decoded._tag === 'Left') {
        rejected += 1;
      } else if (decoded.right !== undefined) {
        events.push(decoded.right);
      }
    }
    if (rejected > 0) {
      yield* Effect.logWarning('Invalid nibrunner tenant log records were skipped').pipe(
        Effect.annotateLogs({ appId, records: rejected }),
      );
    }
    return events;
  });
}

type LogFiles = { directory: string; cursors: Pick<NibrunnerLogCursors, 'get' | 'commit'> };
type LogRequest = { appIds: readonly AppId[]; hostId: HostId };

function readApp({
  appId,
  hostId,
  directory,
  cursors,
}: LogFiles & { appId: AppId; hostId: HostId }) {
  return Effect.gen(function* () {
    const cursor = yield* cursors.get(appId);
    const chunk = yield* readNibrunnerLogChunk({ directory, appId, cursor }).pipe(
      Effect.catchAll(() =>
        Effect.logWarning('A nibrunner tenant log file could not be read').pipe(
          Effect.annotateLogs({ appId }),
          Effect.as(undefined),
        ),
      ),
    );
    if (chunk === undefined) {
      return undefined;
    }
    return {
      events: yield* decodeChunk({ chunk, appId, hostId }),
      position: { appId, ...chunk.cursor },
      bytes: chunk.bytes,
    };
  });
}

function collectBatch({
  appIds,
  hostId,
  start,
  directory,
  cursors,
}: LogFiles & LogRequest & { start: number }) {
  return Effect.gen(function* () {
    const events: TenantLogEvent[] = [];
    const positions: NibrunnerLogPosition[] = [];
    let bytes = 0;
    let following = start;
    for (let index = 0; index < appIds.length && bytes < MAX_NIBRUNNER_LOG_READ_BYTES; index++) {
      const position = (start + index) % appIds.length;
      const chunk = yield* readApp({ appId: appIds[position]!, hostId, directory, cursors });
      following = (position + 1) % appIds.length;
      if (chunk === undefined) {
        continue;
      }
      if (positions.length > 0 && bytes + chunk.bytes > MAX_NIBRUNNER_LOG_READ_BYTES) {
        following = position;
        break;
      }
      events.push(...chunk.events);
      positions.push(chunk.position);
      bytes += chunk.bytes;
    }
    return { events, positions, following };
  });
}

export function makeNibrunnerLogDelivery({
  directory,
  store,
  cursors,
}: LogFiles & { store: LogStoreClient }) {
  return Effect.gen(function* () {
    const next = yield* Ref.make(0);

    function send({ appIds: asked, hostId }: LogRequest) {
      return Effect.gen(function* () {
        const appIds = [...new Set(asked)].sort();
        if (appIds.length === 0) {
          return false;
        }
        const start = (yield* Ref.get(next)) % appIds.length;
        const batch = yield* collectBatch({ appIds, hostId, start, directory, cursors });
        yield* Ref.set(next, batch.following);
        if (batch.positions.length === 0) {
          return false;
        }
        yield* store.publish({ events: batch.events, hostId });
        yield* cursors.commit(batch.positions);
        return true;
      });
    }

    return { send };
  });
}
