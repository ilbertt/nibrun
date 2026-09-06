import type { HostId, SecretString } from '@repo/protocol';

type OpenSession = {
  hostId: HostId;
  expiresAt: Date;
};

/**
 * A host's identity between two polls. In memory, like the observation it goes with: a restarted
 * api has admitted no host yet, and the next poll opens a session again.
 *
 * The lifetime the host is told about is the one enforced here, so a token the agent has already
 * been told to stop presenting is one this end has already stopped honouring.
 */
export class AgentSessions {
  readonly #byToken = new Map<string, OpenSession>();

  open({
    sessionToken,
    hostId,
    expiresAt,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
    expiresAt: Date;
  }): void {
    this.#byToken.set(sessionToken, { hostId, expiresAt });
  }

  /**
   * Expiry is settled on the way in rather than by a sweep: a token nobody presents again costs
   * one entry, and one presented after it lapsed is the only case that has to be right.
   */
  hostFor({ sessionToken, now }: { sessionToken: string; now: Date }): HostId | undefined {
    const session = this.#byToken.get(sessionToken);
    if (session === undefined) {
      return undefined;
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      this.#byToken.delete(sessionToken);
      return undefined;
    }
    return session.hostId;
  }
}
