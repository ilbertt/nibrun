import type { ServerAnalyticsInput } from '#lib/analytics.ts';
import type { UmamiRepositoryContract } from '#repositories/umami.repository.ts';
import { Service } from '#services/service.ts';

const MAX_PENDING_EVENTS = 32;

export type AnalyticsServiceContract = Pick<AnalyticsService, 'track'>;

export class AnalyticsService extends Service {
  private readonly umamiRepo: UmamiRepositoryContract;
  private pendingEvents = 0;

  constructor(umamiRepo: UmamiRepositoryContract) {
    super();
    this.umamiRepo = umamiRepo;
  }

  async track(input: ServerAnalyticsInput): Promise<void> {
    if (this.pendingEvents >= MAX_PENDING_EVENTS) {
      return;
    }
    this.pendingEvents += 1;
    try {
      await this.umamiRepo.send(input);
    } catch {
      this.logger.warn('Unable to deliver analytics event');
    } finally {
      this.pendingEvents -= 1;
    }
  }
}
