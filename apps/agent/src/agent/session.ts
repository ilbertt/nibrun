import { type AgentSession, DEFAULT_AGENT_POLL_SETTINGS } from '@repo/protocol';
import { Clock, Effect, Option, SynchronizedRef } from 'effect';
import { AgentConfig } from '#config.ts';
import { ControlPlaneError } from '#control/client.ts';
import { isSessionExpiring, openSession } from '#control/session.ts';
import { readHostCapacity } from '#report/capacity.ts';
import { readHostVersions } from '#report/versions.ts';

export class AgentSessionHolder extends Effect.Service<AgentSessionHolder>()('AgentSessionHolder', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const versions = yield* readHostVersions(config.versionsFile);
    const cached = yield* SynchronizedRef.make(Option.none<AgentSession>());

    /**
     * Synchronized because four loops ask for the session, and a plain `Ref` would have every one
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
      forgetIfExpired: (error: unknown) =>
        error instanceof ControlPlaneError && error.isSessionExpired
          ? SynchronizedRef.set(cached, Option.none())
          : Effect.void,
    };
  }),
}) {}
