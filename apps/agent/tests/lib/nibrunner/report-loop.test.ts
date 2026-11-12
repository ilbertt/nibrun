import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import {
  Clock,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Queue,
  Ref,
  Stream,
  TestClock,
  TestContext,
} from 'effect';
import { makeNibrunnerReportLoop } from '#lib/nibrunner/report-loop.ts';
import { ReportSignal } from '#services/report-signal.service.ts';
import { POLL_SETTINGS_FIXTURE } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

const run = provided(Layer.mergeAll(platform, TestContext.TestContext, ReportSignal.Default));
const REPORT_DIRECTORY = '/nibrunner';
const REPORT_FILE = `${REPORT_DIRECTORY}/reported.json`;
const REPORTS_AFTER_IN_FLIGHT_CHANGE = 3;
const RETRY_JITTER_MIDPOINT = 0.5;

function fixture() {
  return Effect.gen(function* () {
    const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
    const sent: number[] = [];
    const paths: string[] = [];
    const sending = { effect: Effect.void };
    const loop = yield* makeNibrunnerReportLoop({
      reportedStateFile: REPORT_FILE,
      reportOnce: Effect.gen(function* () {
        sent.push(yield* Clock.currentTimeMillis);
        yield* Effect.suspend(() => sending.effect);
        return POLL_SETTINGS_FIXTURE;
      }),
    }).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          watch: (path) => {
            paths.push(path);
            return Stream.fromQueue(events);
          },
        }),
      ),
    );
    const fiber = yield* Effect.forkScoped(loop);
    yield* TestClock.adjust('0 millis');
    return { events, sent, paths, sending, fiber };
  });
}

test('a changed report is sent before the heartbeat with a minimum gap between sends', async () => {
  await run(
    Effect.gen(function* () {
      const { events, sent, paths } = yield* fixture();
      expect(paths).toEqual([REPORT_DIRECTORY]);
      expect(sent).toEqual([0]);
      yield* Queue.offer(events, FileSystem.WatchEventUpdate({ path: REPORT_FILE }));
      yield* TestClock.adjust('249 millis');
      expect(sent).toEqual([0]);
      yield* TestClock.adjust('1 millis');
      expect(sent).toEqual([0, POLL_SETTINGS_FIXTURE.minIntervalMs]);
    }),
  );
});

test('bursts of file events coalesce into one report', async () => {
  await run(
    Effect.gen(function* () {
      const { events, sent } = yield* fixture();
      yield* Queue.offerAll(events, [
        FileSystem.WatchEventCreate({ path: REPORT_FILE }),
        FileSystem.WatchEventUpdate({ path: REPORT_FILE }),
        FileSystem.WatchEventRemove({ path: REPORT_FILE }),
      ]);
      yield* TestClock.adjust('250 millis');
      expect(sent).toHaveLength(2);
      yield* TestClock.adjust('1 second');
      expect(sent).toHaveLength(2);
    }),
  );
});

test('temporary reports and unrelated directory changes do not trigger reports', async () => {
  await run(
    Effect.gen(function* () {
      const { events, sent } = yield* fixture();
      yield* Queue.offerAll(events, [
        FileSystem.WatchEventCreate({ path: `${REPORT_FILE}.tmp` }),
        FileSystem.WatchEventUpdate({ path: `${REPORT_DIRECTORY}/desired.json` }),
      ]);
      yield* TestClock.adjust('1 second');
      expect(sent).toEqual([0]);
    }),
  );
});

test('a quiet host still reports on the heartbeat', async () => {
  await run(
    Effect.gen(function* () {
      const { sent } = yield* fixture();
      yield* TestClock.adjust('15 seconds');
      expect(sent).toEqual([0, POLL_SETTINGS_FIXTURE.reportIntervalMs]);
    }),
  );
});

test('a change during an in-flight report is retained for the next report', async () => {
  await run(
    Effect.gen(function* () {
      const { events, sent, sending } = yield* fixture();
      const release = yield* Deferred.make<void>();
      sending.effect = Deferred.await(release);
      yield* Queue.offer(events, FileSystem.WatchEventUpdate({ path: REPORT_FILE }));
      yield* TestClock.adjust('250 millis');
      expect(sent).toHaveLength(2);
      yield* Queue.offer(events, FileSystem.WatchEventUpdate({ path: REPORT_FILE }));
      yield* TestClock.adjust('1 second');
      expect(sent).toHaveLength(2);
      sending.effect = Effect.void;
      yield* Deferred.succeed(release, undefined);
      yield* TestClock.adjust('250 millis');
      expect(sent).toHaveLength(REPORTS_AFTER_IN_FLIGHT_CHANGE);
    }),
  );
});

test('watch failures leave heartbeats running and changes resume when the watch recovers', async () => {
  await run(
    Effect.gen(function* () {
      const available = yield* Ref.make(false);
      const events = yield* Queue.unbounded<FileSystem.WatchEvent>();
      const sent: number[] = [];
      const loop = yield* makeNibrunnerReportLoop({
        reportedStateFile: REPORT_FILE,
        reportOnce: Effect.gen(function* () {
          sent.push(yield* Clock.currentTimeMillis);
          return POLL_SETTINGS_FIXTURE;
        }),
      }).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            watch: (path) =>
              Stream.unwrap(
                Ref.get(available).pipe(
                  Effect.map((ready) =>
                    ready ? Stream.fromQueue(events) : FileSystem.makeNoop({}).watch(path),
                  ),
                ),
              ),
          }),
        ),
      );
      yield* Effect.forkScoped(loop);
      yield* TestClock.adjust('15 seconds');
      expect(sent).toEqual([0, POLL_SETTINGS_FIXTURE.reportIntervalMs]);
      yield* Ref.set(available, true);
      yield* TestClock.adjust('16 seconds');
      yield* Queue.offer(events, FileSystem.WatchEventUpdate({ path: REPORT_FILE }));
      yield* TestClock.adjust('0 millis');
      expect(sent.at(-1)).toBe(yield* Clock.currentTimeMillis);
    }).pipe(Effect.withRandomFixed([RETRY_JITTER_MIDPOINT])),
  );
});

test('interrupting the report loop closes its file watch', async () => {
  await run(
    Effect.gen(function* () {
      const closed = yield* Deferred.make<void>();
      const loop = yield* makeNibrunnerReportLoop({
        reportedStateFile: REPORT_FILE,
        reportOnce: Effect.succeed(POLL_SETTINGS_FIXTURE),
      }).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            watch: () => Stream.never.pipe(Stream.ensuring(Deferred.succeed(closed, undefined))),
          }),
        ),
      );
      const fiber = yield* Effect.forkScoped(loop);
      yield* TestClock.adjust('0 millis');
      yield* Fiber.interrupt(fiber);
      expect(yield* Deferred.isDone(closed)).toBe(true);
    }),
  );
});
