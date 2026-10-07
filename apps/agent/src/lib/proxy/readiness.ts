import type { AppId } from '@repo/protocol';
import { Data, Duration, Effect, Schedule } from 'effect';
import { STARTUP_PROBE_INTERVAL_MS } from '#lib/health/state.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { AgentState } from '#services/agent-state.service.ts';

const WAIT_TIMEOUT = Duration.seconds(60);
const WAIT_INTERVAL = Duration.millis(STARTUP_PROBE_INTERVAL_MS);

type Readiness = {
  readonly record: InstanceRecord | undefined;
  readonly waiting: boolean;
};

export class AppStartTimedOut extends Data.TaggedError('AppStartTimedOut')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `${this.appId} did not finish starting within ${Duration.toSeconds(WAIT_TIMEOUT)}s`;
  }
}

export function waitForApp(appId: AppId) {
  return Effect.map(AgentState.snapshot, (current) => {
    const record = current.records.get(appId);
    const waiting =
      current.replacing.has(appId) ||
      (record?.desiredRunning === true &&
        (record.state === 'pending' || record.state === 'starting'));
    return { record, waiting };
  }).pipe(
    Effect.repeat({
      schedule: Schedule.identity<Readiness>().pipe(Schedule.addDelay(() => WAIT_INTERVAL)),
      until: ({ waiting }) => !waiting,
    }),
    Effect.map(({ record }) => record),
    Effect.timeoutFail({
      duration: WAIT_TIMEOUT,
      onTimeout: () => new AppStartTimedOut({ appId }),
    }),
  );
}
