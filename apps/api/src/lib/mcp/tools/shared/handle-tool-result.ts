import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ServerAnalyticsEventData } from '@repo/analytics/events';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { createLogger } from '#lib/logger.ts';
import type { AnalyticsServiceContract } from '#services/analytics.service.ts';

const logger = createLogger('mcp:tools');

type StructuredContent = NonNullable<CallToolResult['structuredContent']>;

export function handleToolResult<Args extends unknown[]>({
  callback,
  analyticsService,
  ownerId,
  toolName,
  trackingAllowed,
}: {
  callback: (...args: Args) => StructuredContent | Promise<StructuredContent>;
  analyticsService: AnalyticsServiceContract;
  ownerId: OwnerId;
  toolName: string;
  trackingAllowed: boolean;
}) {
  return async function trackedToolResult(...args: Args): Promise<CallToolResult> {
    const startedAt = performance.now();
    let outcome: ServerAnalyticsEventData['mcp_tool_completed']['outcome'] = 'error';
    try {
      const result = await callback(...args);
      const response = {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      } satisfies CallToolResult;
      outcome = 'success';
      return response;
    } catch (error) {
      logger.error(`${toolName} failed`, error);
      return {
        isError: true,
        content: [{ type: 'text', text: 'Unable to complete request. Try again later.' }],
      };
    } finally {
      if (trackingAllowed) {
        void analyticsService.track({
          ownerId,
          event: {
            name: 'mcp_tool_completed',
            data: {
              tool_name: toolName,
              outcome,
              duration_ms: Math.round(performance.now() - startedAt),
            },
          },
        });
      }
    }
  };
}
