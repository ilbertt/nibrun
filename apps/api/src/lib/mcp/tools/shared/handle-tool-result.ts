import type { CallToolResult, InputRequiredResult } from '@modelcontextprotocol/server';
import { InvalidBucketSetupError } from '#lib/bucket-setup.ts';
import { CustomBucketsDisabledError } from '#lib/custom-bucket-access.ts';
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
      if (error instanceof CustomBucketsDisabledError || error instanceof InvalidBucketSetupError) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
      logger.error(`${callback.name} failed`, error);
      return {
        isError: true,
        content: [{ type: 'text', text: 'Unable to complete request.' }],
      };
    }
  };
}
