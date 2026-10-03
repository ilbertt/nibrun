import { AGENT_ROUTES, ExportLogsRequestSchema, type TenantLogRecord } from '@repo/protocol';
import { Elysia, sse } from 'elysia';
import { assertProtocolVersion } from '#lib/agent/protocol-version.ts';
import { agentRoutePath } from '#lib/agent/routes.ts';
import { sessionTokenFrom } from '#lib/agent/session-token.ts';
import { ProtocolHeadersSchema } from '#routes/internal/agent/model.ts';
import { AgentServicePlugin, ExportLogsServicePlugin } from '#services/plugins.ts';

export const AgentExportLogsController = new Elysia()
  .use(AgentServicePlugin)
  .use(ExportLogsServicePlugin)
  .post(
    agentRoutePath(AGENT_ROUTES.exportLogs),
    async ({ agentService, exportLogsService, headers, body, request }) => {
      assertProtocolVersion(headers);
      const hostId = await agentService.hostForSession({ sessionToken: sessionTokenFrom(headers) });
      const records = await exportLogsService.open({
        hostId,
        exportId: body.exportId,
        signal: request.signal,
      });
      return events(records);
    },
    { body: ExportLogsRequestSchema, headers: ProtocolHeadersSchema },
  );

async function* events(records: AsyncIterable<TenantLogRecord>) {
  for await (const record of records) {
    yield sse({ event: 'log', data: record });
  }
  // A normal HTTP close alone cannot distinguish a complete export from a failed query.
  yield sse({ event: 'complete', data: {} });
}
