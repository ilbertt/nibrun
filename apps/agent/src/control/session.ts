import {
  type AgentSession,
  type HostCapacity,
  type HostId,
  HostIdSchema,
  type HostVersions,
  isValidMessage,
  type SecretString,
} from '@repo/protocol';
import type { ControlPlaneClient } from '#control/client.ts';
import { toEpochMs } from '#lib/clock.ts';
import { readTextFile, writeTextFile } from '#lib/json-store.ts';

// Renewed well before it lapses: a session that expires mid-poll costs a round trip, and the
// clock the control plane stamped it with is not the one the agent reads it against.
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

/**
 * The host id the control plane assigned, kept on disk so a reinstalled agent rejoins as the
 * same host rather than as a new one. A file that has been corrupted is discarded rather than
 * sent, because registering twice is recoverable and claiming a malformed identity is not.
 */
export class HostIdentity {
  readonly #path: string;

  constructor({ path }: { path: string }) {
    this.#path = path;
  }

  async read(): Promise<HostId | undefined> {
    const value = await readTextFile({ path: this.#path });
    if (value === undefined || !isValidMessage({ schema: HostIdSchema, value })) {
      return undefined;
    }
    return value as HostId;
  }

  async write(hostId: HostId): Promise<void> {
    await writeTextFile({ path: this.#path, value: `${hostId}\n` });
  }
}

export type SessionInputs = {
  bootstrapToken: SecretString;
  versions: HostVersions;
  capacity: HostCapacity;
};

export async function openSession({
  client,
  identity,
  inputs,
}: {
  client: ControlPlaneClient;
  identity: HostIdentity;
  inputs: SessionInputs;
}): Promise<AgentSession> {
  const hostId = await identity.read();
  const session = await client.openSession({
    bootstrapToken: inputs.bootstrapToken,
    ...(hostId ? { hostId } : {}),
    versions: inputs.versions,
    capacity: inputs.capacity,
  });
  if (session.hostId !== hostId) {
    await identity.write(session.hostId);
  }
  return session;
}
