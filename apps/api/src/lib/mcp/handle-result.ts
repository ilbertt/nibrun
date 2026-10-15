import type { CallToolResult } from '@modelcontextprotocol/server';
import { createLogger } from '#lib/logger.ts';

const logger = createLogger('mcp:tools');

type StructuredContent = NonNullable<CallToolResult['structuredContent']>;

export function handleResult<Args extends unknown[]>(
  callback: (...args: Args) => StructuredContent | Promise<StructuredContent>,
) {
  return async function handleToolResult(...args: Args): Promise<CallToolResult> {
    try {
      const result = await callback(...args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      logger.error(`${callback.name} failed`, error);
      return {
        isError: true,
        content: [{ type: 'text', text: 'Unable to complete request. Try again later.' }],
      };
    }
  };
}
