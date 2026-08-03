import type { HostDesiredState, HostId, HostReportedState, SecretString } from '@repo/protocol';
import { Repository } from '#repositories/repository.ts';

// Where the schema goes when there is one. Until then a host is told to run
// nothing, which is a true answer rather than a placeholder: no app has been
// created, so an empty desired state is exactly what the fleet should converge
// to, and converging to it exercises every step converging to an app would.
// Generation 1, not 0: an agent that has never polled reports knowing generation
// 0, so state published at 0 answers `unchanged` and the host is never told
// anything at all. Zero means "nothing has been published to this host yet" and
// belongs to no real state.
const FIRST_GENERATION = 1;

const NOTHING_TO_RUN = {
  generation: FIRST_GENERATION,
  volumes: [],
  instances: [],
  checkpoints: [],
  exports: [],
} as const satisfies Omit<HostDesiredState, 'hostId'>;

export class AgentRepository extends Repository {
  // In this process rather than in Postgres, which is the one thing here that is
  // not simply "a table is missing": a session is ephemeral, so losing the map
  // when the api restarts costs a re-registration the agent already retries.
  // Every other read below is a query waiting to be written.
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

  desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    return Promise.resolve({ hostId, ...NOTHING_TO_RUN });
  }

  // Reported state is the fleet's view of itself and belongs beside the desired
  // state it answers. Dropped rather than held in memory: an in-process copy
  // would be a second source of truth to unpick later.
  saveReportedState(_: { reported: HostReportedState }): Promise<void> {
    return Promise.resolve();
  }
}
