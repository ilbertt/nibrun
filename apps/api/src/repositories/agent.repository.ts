import type { HostId, SecretString } from '@repo/protocol';
import { Repository } from '#repositories/repository.ts';

export abstract class AgentRepositoryContract {
  abstract saveSession(input: { sessionToken: SecretString; hostId: HostId }): Promise<void>;
  abstract hostForSession(input: { sessionToken: string }): Promise<HostId | undefined>;
}

export class AgentRepository extends Repository implements AgentRepositoryContract {
  // In this process rather than in Postgres: a session is ephemeral, so losing the map when the
  // api restarts costs a re-registration the agent already retries. What a session resolves to
  // is a host, and while there is one host that is a constant rather than a row.
  readonly #hostBySession = new Map<string, HostId>();

  saveSession({
    sessionToken,
    hostId,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
  }): Promise<void> {
    this.#hostBySession.set(sessionToken, hostId);
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.#hostBySession.get(sessionToken));
  }
}
