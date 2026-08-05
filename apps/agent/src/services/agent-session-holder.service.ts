import { type AgentSession, DEFAULT_AGENT_POLL_SETTINGS } from '@repo/protocol';
import { Clock, Effect, Option, SynchronizedRef } from 'effect';
import type { ControlPlaneError } from '#lib/control/client.ts';
import { isSessionExpiring, openSession } from '#lib/control/session.ts';
import { readHostCapacity } from '#lib/report/capacity.ts';
import { readHostVersions } from '#lib/report/versions.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class AgentSessionHolder extends Effect.Service<AgentSessionHolder>()('AgentSessionHolder', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const versions = yield* readHostVersions(config.versionsFile);
    const cached = yield* SynchronizedRef.make(Option.none<AgentSession>());

    /**
     * Synchronized because every loop asks for the session, and a plain `Ref` would have each one
     * of them see the same expired value and open a session of its own.
     */
    const current = SynchronizedRef.modifyEffect(cached, (existing) =>
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        if (Option.isSome(existing) && !isSessionExpiring({ session: existing.value, nowMs })) {
          return [existing.value, existing] as const;
        }
        const capacity = yield* readHostCapacity(config.stateDir);
        const session = yield* openSession({ versions, capacity });
        yield* Effect.logInfo('session opened').pipe(
          Effect.annotateLogs({ hostId: session.hostId, expiresAt: session.expiresAt }),
        );
        return [session, Option.some(session)] as const;
      }),
    );

    return {
      versions,
      current,
      pollSettings: Effect.map(
        SynchronizedRef.get(cached),
        Option.match({
          onNone: () => DEFAULT_AGENT_POLL_SETTINGS,
          onSome: (session: AgentSession) => session.poll,
        }),
      ),
      /**
       * Attached with `tapErrorTag` where the error channel is concrete, rather than handed a
       * caller's error as `unknown`: a 401 is in the type of the call that can produce one.
       */
      onExpired: (error: ControlPlaneError) =>
        error.isSessionExpired ? SynchronizedRef.set(cached, Option.none()) : Effect.void,
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}
