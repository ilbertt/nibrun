import type {
  InputRequiredResult,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { Type } from '@sinclair/typebox';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';

export function assertToolTypeSafety({
  server,
  inputRequired,
}: {
  server: McpServer;
  inputRequired: InputRequiredResult;
}) {
  const inputSchema = fromTypeBox(Type.Object({ value: Type.String() }));
  const outputSchema = fromTypeBox(Type.Object({ echoed: Type.String() }));
  const config = { inputSchema, outputSchema };
  type Output = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

  registerTool({
    server,
    name: 'valid',
    config,
    callback: handleToolResult(function echo({
      value,
    }: StandardSchemaWithJSON.InferOutput<typeof inputSchema>): Output {
      return { echoed: value.toUpperCase() };
    }),
  });
  registerTool({
    server,
    name: 'request-input',
    config,
    callback: function requestInput() {
      return inputRequired;
    },
  });
  registerTool({
    server,
    name: 'wrong-input',
    config,
    // @ts-expect-error Callback arguments must match the input schema.
    callback: handleToolResult(function wrongInput({ value }: { value: number }) {
      return { echoed: String(value) };
    }),
  });
  registerTool({
    server,
    name: 'wrong-output',
    config,
    // @ts-expect-error Callback results must match the output schema.
    callback: handleToolResult(function wrongOutput() {
      return { echoed: 42 };
    }),
  });
  registerTool({
    server,
    name: 'missing-output',
    config,
    // @ts-expect-error Callback results must include required output properties.
    callback: handleToolResult(function missingOutput() {
      return {};
    }),
  });
  registerTool({
    server,
    name: 'wrong-async-output',
    config,
    // @ts-expect-error Asynchronous results must also match the output schema.
    callback: handleToolResult(function wrongAsyncOutput() {
      return Promise.resolve({ echoed: 42 });
    }),
  });
}
