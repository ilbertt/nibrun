import type { ServerAnalyticsEvent } from '@repo/analytics/events';
import type { OwnerId } from '#lib/api/identifiers.ts';

export type ServerAnalyticsInput = { ownerId: OwnerId; event: ServerAnalyticsEvent };
