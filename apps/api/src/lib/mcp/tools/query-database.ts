import type { McpServer, StandardSchemaWithJSON, ToolCallback } from '@modelcontextprotocol/server';
import { MCP_TOOL_NAMES } from '@repo/api-constants';
import { HranaStmtResultSchema, HranaStmtSchema } from '@repo/sqlite';
import { Type } from '@sinclair/typebox';
import type { OwnerId } from '#lib/api/identifiers.ts';
import { SqliteConnectionSchema } from '#lib/api/sqlite-connection.ts';
import { fromTypeBox } from '#lib/mcp/schema.ts';
import { handleToolResult } from '#lib/mcp/tools/shared/handle-tool-result.ts';
import { registerTool } from '#lib/mcp/tools/shared/register-tool.ts';
import { sqliteRequestSignal } from '#lib/sqlite/http.ts';
import type { SqliteService } from '#services/sqlite.service.ts';

const inputSchema = fromTypeBox(
  Type.Object(
    {
      ...Type.Pick(SqliteConnectionSchema, ['appId', 'sqlite_file_path']).properties,
      sql: Type.Extract(Type.Required(HranaStmtSchema).properties.sql, Type.String()),
      ...Type.Pick(HranaStmtSchema, ['args', 'named_args']).properties,
    },
    { additionalProperties: false },
  ),
);
const outputSchema = fromTypeBox(Type.Object({ result: HranaStmtResultSchema }));

type QueryDatabaseInput = StandardSchemaWithJSON.InferOutput<typeof inputSchema>;
type QueryDatabaseOutput = StandardSchemaWithJSON.InferOutput<typeof outputSchema>;

export function registerQueryDatabaseTool({
  server,
  sqliteService,
  ownerId,
}: {
  server: McpServer;
  sqliteService: SqliteService;
  ownerId: OwnerId;
}) {
  registerTool({
    server,
    name: MCP_TOOL_NAMES.queryDatabase,
    config: {
      title: 'Query nibrun database',
      description:
        'Execute one read-only SQL statement against a SQLite file on an app owned by your connected nibrun account. Supply appId, sqlite_file_path and sql; the running deployment and database connection are selected automatically. A saved connection is created if needed. Optional args and named_args use Hrana typed values. Returns columns, typed rows, affected row count and last insert row ID.',
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    callback: handleToolResult(async function queryDatabase(
      ...[{ appId, sqlite_file_path, ...stmt }, context]: [
        QueryDatabaseInput,
        Parameters<ToolCallback<typeof inputSchema>>[1],
      ]
    ): Promise<QueryDatabaseOutput> {
      return {
        result: await sqliteService.query({
          appId,
          ownerId,
          sqlite_file_path,
          stmt,
          signal: sqliteRequestSignal(context.mcpReq),
        }),
      };
    }),
  });
}
