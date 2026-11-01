import type { AgentSession, AppId, FilesystemQuery, FilesystemQueryResult } from '@repo/protocol';
import { Duration, Effect } from 'effect';
import type { ControlPlaneClient } from '#lib/control/client.ts';
import { NibrunnerFilesystemUnavailable } from '#lib/nibrunner/filesystem.ts';
import { NibrunnerFilesystem } from '#services/nibrunner-filesystem.service.ts';

const IDLE_POLL_FLOOR = '5 seconds';

function answer<E, R>({
  query,
  servedAppIds,
}: {
  query: FilesystemQuery;
  servedAppIds: Effect.Effect<readonly AppId[], E, R>;
}) {
  return Effect.gen(function* () {
    const filesystem = yield* NibrunnerFilesystem;
    if (!(yield* servedAppIds).includes(query.appId)) {
      return yield* new NibrunnerFilesystemUnavailable();
    }
    const listing = yield* filesystem.list(query);
    return {
      queryId: query.queryId,
      outcome: { status: 'listed', listing },
    } satisfies FilesystemQueryResult;
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({
        queryId: query.queryId,
        outcome: { status: 'failed', message: new NibrunnerFilesystemUnavailable().message },
      } satisfies FilesystemQueryResult),
    ),
  );
}

export function pollNibrunnerFilesystem<E, R>({
  control,
  session,
  servedAppIds,
}: {
  control: ControlPlaneClient;
  session: AgentSession;
  servedAppIds: Effect.Effect<readonly AppId[], E, R>;
}) {
  return Effect.gen(function* () {
    const [held, response] = yield* Effect.timed(
      control.fetchFilesystemQuery({
        sessionToken: session.sessionToken,
        request: { servedAppIds: [...(yield* servedAppIds)] },
      }),
    );
    if (response.result === 'none') {
      return yield* Effect.sleep(Duration.subtract(IDLE_POLL_FLOOR, held));
    }
    yield* control.sendFilesystemQueryResult({
      sessionToken: session.sessionToken,
      result: yield* answer({ query: response.query, servedAppIds }),
    });
  });
}
