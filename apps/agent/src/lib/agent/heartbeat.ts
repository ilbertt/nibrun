import { type Duration, Effect, Schedule } from 'effect';
import { supervised } from '#lib/agent/loop.ts';
import { AgentState } from '#services/agent-state.service.ts';

/**
 * Long enough that a quiet host is quiet in the journal too, short enough that the gap between
 * two beats is shorter than anyone's patience when asking whether a host is still there.
 */
const INTERVAL: Duration.DurationInput = '5 minutes';

/**
 * Says the agent is alive on a host that has nothing else to report.
 *
 * Every other loop logs only when something happened or something failed, which is right for
 * them and leaves a converged host emitting nothing at all — indistinguishable, from the store,
 * from one whose agent died. This is the line that tells them apart, so it carries what is worth
 * knowing at a glance rather than only a timestamp.
 */
const beat = Effect.gen(function* () {
  const records = yield* AgentState.records;
  yield* Effect.logInfo('agent alive').pipe(Effect.annotateLogs({ instances: records.length }));
  yield* Effect.sleep(INTERVAL);
});

export const heartbeatLoop = supervised({
  once: beat,
  onFailure: (cause) => Effect.logWarning('heartbeat failed', cause),
  schedule: Schedule.spaced(INTERVAL),
});
