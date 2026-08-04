import { type AgentSession, DEFAULT_AGENT_POLL_SETTINGS } from '@repo/protocol';
import { Clock, Effect, Option, Ref } from 'effect';
import { AgentConfig } from '#config.ts';
import { ControlPlaneError } from '#control/client.ts';
import { isSessionExpiring, openSession } from '#control/session.ts';
import { readHostCapacity } from '#report/capacity.ts';
import { readHostVersions } from '#report/versions.ts';

export class AgentSessionHolder extends Effect.Service<AgentSessionHolder>()('AgentSessionHolder', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const versions = yield* readHostVersions(config.versionsFile);
    const cached = yield* Ref.make(Option.none<AgentSession>());

    const current = Effect.gen(function* () {
      const existing = yield* Ref.get(cached);
      const nowMs = yield* Clock.currentTimeMillis;
      if (Option.isSome(existing) && !isSessionExpiring({ session: existing.value, nowMs })) {
        return existing.value;
      }
      const capacity = yield* readHostCapacity(config.stateDir);
      const session = yield* openSession({ versions, capacity });
      yield* Ref.set(cached, Option.some(session));
      yield* Effect.logInfo('session opened').pipe(
        Effect.annotateLogs({ hostId: session.hostId, expiresAt: session.expiresAt }),
      );
      return session;
    });

    return {
      versions,
      current,
      pollSettings: Effect.map(
        Ref.get(cached),
        Option.match({
          onNone: () => DEFAULT_AGENT_POLL_SETTINGS,
          onSome: (session: AgentSession) => session.poll,
        }),
      ),
      forgetIfExpired: (error: unknown) =>
        error instanceof ControlPlaneError && error.isSessionExpired
          ? Ref.set(cached, Option.none())
          : Effect.void,
    };
  }),
}) {}
