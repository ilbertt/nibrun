import {
  type AgentSession,
  type HostCapacity,
  HostIdSchema,
  type HostVersions,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect, Option } from 'effect';
import { toEpochMs } from '#lib/clock.ts';
import { readTextFile, writeTextFile } from '#lib/json-store.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';

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

const readOrCreateRegistrationId = Effect.gen(function* () {
  const config = yield* AgentConfig;
  const value = yield* readTextFile(config.hostIdFile);
  if (Option.isSome(value)) {
    return yield* Effect.try({
      try: () => Value.Parse(HostIdSchema, value.value),
      catch: () => new InvalidHostIdentity({ path: config.hostIdFile }),
    });
  }
  const hostId = yield* Effect.sync(() => Value.Parse(HostIdSchema, crypto.randomUUID()));
  // A lost first response must retry with the same identity, before any canonical id is known.
  yield* writeTextFile({ path: config.hostIdFile, value: `${hostId}\n` });
  return hostId;
});

export const openSession = Effect.fn('openSession')(function* (inputs: {
  versions: HostVersions;
  capacity: HostCapacity;
}) {
  const control = yield* ControlPlane;
  const hostId = yield* readOrCreateRegistrationId;
  return yield* control.openSession({
    hostId,
    versions: inputs.versions,
    capacity: inputs.capacity,
  });
});
