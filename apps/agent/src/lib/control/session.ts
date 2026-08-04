import {
  type AgentSession,
  type HostCapacity,
  type HostId,
  HostIdSchema,
  type HostVersions,
  isValidMessage,
} from '@repo/protocol';
import { Effect, Option } from 'effect';
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

/** A corrupted file is discarded rather than sent: registering twice is recoverable, claiming a
 * malformed identity is not. */
const readHostId = Effect.gen(function* () {
  const config = yield* AgentConfig;
  const value = yield* readTextFile(config.hostIdFile);
  return Option.filter(value, (hostId) =>
    isValidMessage({ schema: HostIdSchema, value: hostId }),
  ) as Option.Option<HostId>;
});

export const openSession = Effect.fn('openSession')(function* (inputs: {
  versions: HostVersions;
  capacity: HostCapacity;
}) {
  const config = yield* AgentConfig;
  const control = yield* ControlPlane;
  const hostId = yield* readHostId;
  const session = yield* control.openSession({
    ...Option.match(hostId, { onNone: () => ({}), onSome: (value) => ({ hostId: value }) }),
    versions: inputs.versions,
    capacity: inputs.capacity,
  });
  if (!Option.contains(hostId, session.hostId)) {
    yield* writeTextFile({ path: config.hostIdFile, value: `${session.hostId}\n` });
  }
  return session;
});
