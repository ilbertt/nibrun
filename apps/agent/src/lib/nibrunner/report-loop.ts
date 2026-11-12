import { FileSystem, Path } from '@effect/platform';
import type { AgentPollSettings } from '@repo/protocol';
import { Effect, Stream } from 'effect';
import { CONTROL_PLANE_BACKOFF } from '#lib/agent/backoff.ts';
import { supervised } from '#lib/agent/loop.ts';
import { ReportSignal } from '#services/report-signal.service.ts';

export function makeNibrunnerReportLoop<E, R>({
  reportedStateFile,
  reportOnce,
}: {
  reportedStateFile: string;
  reportOnce: Effect.Effect<AgentPollSettings, E, R>;
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const signal = yield* ReportSignal;
    const filename = path.basename(reportedStateFile);

    // Nibrunner replaces the file atomically; a directory watch survives each rename.
    const changes = fs.watch(path.dirname(reportedStateFile)).pipe(
      Stream.filter((event) => path.basename(event.path) === filename),
      Stream.runForEach(() => signal.raise),
    );
    const report = reportOnce.pipe(
      Effect.flatMap((poll) =>
        Effect.race(
          Effect.sleep(`${poll.reportIntervalMs} millis`),
          Effect.andThen(Effect.sleep(`${poll.minIntervalMs} millis`), signal.awaited),
        ),
      ),
    );

    return Effect.all(
      [
        supervised({
          once: changes,
          onFailure: (cause) => Effect.logWarning('nibrunner report watch failed', cause),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
        supervised({
          once: report,
          onFailure: (cause) => Effect.logWarning('nibrunner report failed', cause),
          schedule: CONTROL_PLANE_BACKOFF,
        }),
      ],
      { concurrency: 'unbounded', discard: true },
    );
  });
}
