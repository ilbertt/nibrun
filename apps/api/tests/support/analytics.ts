import { Value } from '@sinclair/typebox/value';
import type { ServerAnalyticsInput } from '#lib/analytics.ts';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';

export const ANALYTICS_INPUT: ServerAnalyticsInput = {
  ownerId: Value.Parse(OwnerIdSchema, crypto.randomUUID()),
  event: {
    name: 'mcp_tool_completed',
    data: { tool_name: 'list_apps', outcome: 'success', duration_ms: 1 },
  },
};
