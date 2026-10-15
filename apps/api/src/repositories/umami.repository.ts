import { UMAMI_WEBSITE_ID } from '@repo/analytics/config';
import type { ServerAnalyticsInput } from '#lib/analytics.ts';
import { RoutePrefix } from '#lib/routes/prefixes.ts';

const SEND_TIMEOUT_MS = 2000;

export abstract class UmamiRepositoryContract {
  abstract send(input: ServerAnalyticsInput): Promise<void>;
}

export class UmamiRepository implements UmamiRepositoryContract {
  private readonly endpoint: URL | undefined;
  private readonly hostname: string;

  constructor({ endpoint, hostname }: { endpoint: URL | undefined; hostname: string }) {
    this.endpoint = endpoint;
    this.hostname = hostname;
  }

  async send({ ownerId, event }: ServerAnalyticsInput): Promise<void> {
    if (!this.endpoint) {
      return;
    }
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'nibrun/1.0' },
      body: JSON.stringify({
        type: 'event',
        payload: {
          website: UMAMI_WEBSITE_ID,
          hostname: this.hostname,
          url: RoutePrefix.Mcp,
          id: ownerId,
          name: event.name,
          data: { ...event.data, account_id: ownerId, source: 'mcp', site: 'api' },
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error(`Umami returned HTTP ${response.status}`);
    }
  }
}
