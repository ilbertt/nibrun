import type { McpServer, StandardSchemaWithJSON, ToolCallback } from '@modelcontextprotocol/server';
import type { ToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { MCP_TOOL_META } from '#lib/mcp/tools/shared/tool-meta.ts';

type ToolConfiguration = Omit<
  Parameters<McpServer['registerTool']>[1],
  'inputSchema' | 'outputSchema'
>;

export function registerTool<Input, Output>({
  server,
  name,
  config,
  callback,
}: {
  server: McpServer;
  name: string;
  config: ToolConfiguration & {
    inputSchema: StandardSchemaWithJSON<unknown, Input>;
    outputSchema: StandardSchemaWithJSON<unknown, Output>;
  };
  callback: (
    ...args: Parameters<ToolCallback<StandardSchemaWithJSON<unknown, NoInfer<Input>>>>
  ) => ToolResult<NoInfer<Output>> | Promise<ToolResult<NoInfer<Output>>>;
}): ReturnType<McpServer['registerTool']> {
  return server.registerTool(
    name,
    { ...config, _meta: { ...config._meta, ...MCP_TOOL_META } },
    callback,
  );
}
