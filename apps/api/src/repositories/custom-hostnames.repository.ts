import type { AppHostnameState, Hostname } from '@repo/protocol';
import type { CloudflareClient, CustomHostname } from '#lib/cloudflare/client.ts';

/**
 * Cloudflare answers a hostname's activation and its certificate separately, and traffic needs
 * both. Anything that is neither serving nor finished stays `pending`, because the edge retries
 * on its own and calling it failed would strand a hostname that was about to work.
 */
const ACTIVE_HOSTNAME_STATUS = 'active';
const ACTIVE_SSL_STATUS = 'active';

/**
 * The states the edge will not leave without being asked again. A timeout is terminal here even
 * though it reads transient: it means the owner never placed the records, and the row is what
 * tells them so.
 */
const TERMINAL_HOSTNAME_STATUSES = new Set(['blocked', 'moved', 'deleted']);
const TERMINAL_SSL_STATUSES = new Set([
  'initializing_timed_out',
  'validation_timed_out',
  'issuance_timed_out',
  'deployment_timed_out',
  'deletion_timed_out',
  'expired',
]);

export type EdgeHostname = {
  cloudflareId: string;
  state: AppHostnameState;
};

/**
 * No client, because the deployment configured no Cloudflare account. Thrown rather than answered
 * with a value, so a caller that forgot to ask `available` first cannot mistake "not configured"
 * for "the edge said no".
 */
export class CustomHostnamesUnavailableError extends Error {
  constructor() {
    super('No Cloudflare account is configured for this deployment.');
    this.name = 'CustomHostnamesUnavailableError';
  }
}

export abstract class CustomHostnamesRepositoryContract {
  /** Whether this deployment can register a hostname at the edge at all. */
  abstract readonly available: boolean;
  abstract add(input: { hostname: Hostname }): Promise<EdgeHostname>;
  abstract dcvTarget(input: { hostname: Hostname }): Promise<string>;
  abstract state(input: { cloudflareId: string }): Promise<AppHostnameState>;
  abstract remove(input: { cloudflareId: string }): Promise<void>;
}

/**
 * The edge's view of a hostname, in this codebase's vocabulary. Cloudflare's two status fields
 * and its several dozen values are collapsed here rather than in a service, so nothing above has
 * to know which of them mean the hostname is serving.
 */
export class CustomHostnamesRepository implements CustomHostnamesRepositoryContract {
  private readonly client: CloudflareClient | undefined;

  /**
   * Absent on every deployment that configured no Cloudflare account, which is every local stack.
   * Held here rather than left to the caller: whether the edge can be reached is a fact about the
   * system this fronts, and a service that had to be constructed differently without one would be
   * carrying that fact for it.
   */
  constructor(client: CloudflareClient | undefined) {
    this.client = client;
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  async add({ hostname }: { hostname: Hostname }): Promise<EdgeHostname> {
    const created = await this.reachable().createCustomHostname({ hostname });
    return { cloudflareId: created.id, state: toState(created) };
  }

  // `async` like its siblings: a method returning a promise has to reject rather than throw where
  // the caller is reaching for `.catch`.
  async dcvTarget({ hostname }: { hostname: Hostname }): Promise<string> {
    return await this.reachable().dcvDelegationTarget({ hostname });
  }

  async state({ cloudflareId }: { cloudflareId: string }): Promise<AppHostnameState> {
    return toState(await this.reachable().getCustomHostname({ id: cloudflareId }));
  }

  async remove({ cloudflareId }: { cloudflareId: string }): Promise<void> {
    await this.reachable().deleteCustomHostname({ id: cloudflareId });
  }

  private reachable(): CloudflareClient {
    if (!this.client) {
      throw new CustomHostnamesUnavailableError();
    }
    return this.client;
  }
}

export function toState(hostname: CustomHostname): AppHostnameState {
  if (hostname.status === ACTIVE_HOSTNAME_STATUS && hostname.ssl.status === ACTIVE_SSL_STATUS) {
    return 'active';
  }
  if (
    TERMINAL_HOSTNAME_STATUSES.has(hostname.status) ||
    TERMINAL_SSL_STATUSES.has(hostname.ssl.status)
  ) {
    return 'failed';
  }
  return 'pending';
}
