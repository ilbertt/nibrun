import {
  type AgentSession,
  type HostCapacity,
  HostIdSchema,
  type HostVersions,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Clock, Data, Effect, Option, SynchronizedRef } from 'effect';
import { toEpochMs } from '#lib/clock.ts';
import type { ControlPlaneClient, ControlPlaneError } from '#lib/control/client.ts';
import { UNREGISTERED_POLL_SETTINGS } from '#lib/control/poll-settings.ts';
import { readTextFile, writeTextFile } from '#lib/json-store.ts';

/** Renewed early: a session that expires mid-poll costs a round trip, and the clock that stamped
 * it is not the one the agent reads it against. */
const RENEWAL_SKEW_MS = 60_000;

export function isSessionExpiring({
  session,
  nowMs,
  skewMs = RENEWAL_SKEW_MS,
}: {
  session: AgentSession;
  nowMs: number;
  skewMs?: number;
}): boolean {
  return toEpochMs(session.expiresAt) - skewMs <= nowMs;
}

export class InvalidHostIdentity extends Data.TaggedError('InvalidHostIdentity')<{
  readonly path: string;
}> {
  override get message() {
    return `The persisted host identity at ${this.path} is invalid.`;
  }
}

const readOrCreateRegistrationId = Effect.fn('readOrCreateRegistrationId')(function* (
  path: string,
) {
  const value = yield* readTextFile(path);
  if (Option.isSome(value)) {
    return yield* Effect.try({
      try: () => Value.Parse(HostIdSchema, value.value),
      catch: () => new InvalidHostIdentity({ path }),
    });
  }
  const hostId = yield* Effect.sync(() => Value.Parse(HostIdSchema, crypto.randomUUID()));
  // A lost first response must retry with the same identity, before any canonical id is known.
  yield* writeTextFile({ path, value: `${hostId}\n` });
  return hostId;
});

export const openSession = Effect.fn('openSession')(function* (inputs: {
  control: ControlPlaneClient;
  hostIdFile: string;
  versions: HostVersions;
  capacity: HostCapacity;
}) {
  const hostId = yield* readOrCreateRegistrationId(inputs.hostIdFile);
  return yield* inputs.control.openSession({
    hostId,
    versions: inputs.versions,
    capacity: inputs.capacity,
  });
});

export function makeSessionHolder<E, R>({
  control,
  hostIdFile,
  versions,
  capacity,
}: {
  control: ControlPlaneClient;
  hostIdFile: string;
  versions: HostVersions;
  capacity: Effect.Effect<HostCapacity, E, R>;
}) {
  return Effect.gen(function* () {
    const cached = yield* SynchronizedRef.make(Option.none<AgentSession>());
    // All polling loops share one renewal, including while registration is in flight.
    const current = SynchronizedRef.modifyEffect(cached, (existing) =>
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        if (Option.isSome(existing) && !isSessionExpiring({ session: existing.value, nowMs })) {
          return [existing.value, existing] as const;
        }
        const session = yield* openSession({
          control,
          hostIdFile,
          versions,
          capacity: yield* capacity,
        });
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
          onNone: () => UNREGISTERED_POLL_SETTINGS,
          onSome: (session: AgentSession) => session.poll,
        }),
      ),
      onExpired: (error: ControlPlaneError) =>
        error.isSessionExpired ? SynchronizedRef.set(cached, Option.none()) : Effect.void,
    };
  });
}
