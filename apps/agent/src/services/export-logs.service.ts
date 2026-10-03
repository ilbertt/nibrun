import { Path } from '@effect/platform';
import type { ExportId } from '@repo/protocol';
import { Effect } from 'effect';
import { EXPORTED_LOGS_FILENAME, writeExportLogs } from '#lib/exports/logs.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';

export class ExportLogs extends Effect.Service<ExportLogs>()('ExportLogs', {
  effect: Effect.gen(function* () {
    const sessions = yield* AgentSessionHolder;
    const control = yield* ControlPlane;
    const path = yield* Path.Path;
    return {
      write: Effect.fn('ExportLogs.write')(function* ({
        exportId,
        stagingDir,
      }: {
        exportId: ExportId;
        stagingDir: string;
      }) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const controller = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (current) => Effect.sync(() => current.abort()),
            );
            const session = yield* sessions.current.pipe(
              Effect.provideService(ControlPlane, control),
            );
            const events = yield* control
              .fetchExportLogs({
                sessionToken: session.sessionToken,
                request: { exportId },
                signal: controller.signal,
              })
              .pipe(Effect.tapErrorTag('ControlPlaneError', sessions.onExpired));
            return yield* writeExportLogs({
              events,
              destination: path.join(stagingDir, EXPORTED_LOGS_FILENAME),
              cancel: Effect.sync(() => controller.abort()),
            });
          }),
        );
      }),
    };
  }),
  dependencies: [AgentSessionHolder.Default, ControlPlane.Default],
}) {}
