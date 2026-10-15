import { websiteIcon } from '#lib/oauth-client-icon.ts';
import type { ClientWebsiteRepositoryContract } from '#repositories/client-website.repository.ts';
import { Service } from '#services/service.ts';

export class OAuthClientIconService extends Service {
  private readonly clientWebsiteRepo: ClientWebsiteRepositoryContract;

  constructor({ clientWebsiteRepo }: { clientWebsiteRepo: ClientWebsiteRepositoryContract }) {
    super();
    this.clientWebsiteRepo = clientWebsiteRepo;
  }

  async discover({ url }: { url: string }): Promise<string | null> {
    try {
      const website = await this.clientWebsiteRepo.read({ url });
      return website ? websiteIcon(website) : null;
    } catch {
      return null;
    }
  }
}
