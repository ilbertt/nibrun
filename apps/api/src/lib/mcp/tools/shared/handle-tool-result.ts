import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/server';
import { createLogger } from '#lib/logger.ts';

const logger = createLogger('mcp:tools');

type StructuredContent = Exclude<CallToolResult['structuredContent'], undefined>;

export type ToolResult<Output> =
  | (CallToolResult & { structuredContent: Output })
  | (CallToolResult & { isError: true })
  | InputRequiredResult;

export function handleToolResult<Args extends unknown[], Output extends StructuredContent>(
  callback: (...args: Args) => Output | Promise<Output>,
) {
  return async (...args: Args): Promise<ToolResult<Output>> => {
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
        content: [{ type: 'text', text: 'Unable to complete request.' }],
      };
    }
  };
}
