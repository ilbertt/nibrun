import { createNibrunMcpHandler } from '#lib/mcp/handler.ts';
import type { McpServices } from '#lib/mcp/services.ts';
import { OWNER_ID } from '#tests/lib/mcp/support/services.ts';

export type Replied = {
  result?: {
    content: { text: string }[];
    structuredContent?: unknown;
    isError?: boolean;
  };
};

export function toolCall({ name, args }: { name: string; args: Record<string, unknown> }) {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
}

/**
 * One request against the endpoint as a client reaches it, rather than a tool function called
 * directly: what is being checked is that the tool is registered, that its schema takes what was
 * sent, and that what it answered survives being serialised — none of which a direct call sees.
 */
export async function called({
  services,
  body,
}: {
  services: McpServices;
  body: unknown;
}): Promise<Replied> {
  const handler = createNibrunMcpHandler({ services });
  const response = await handler.fetch(
    new Request('https://nibrun.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
    { authInfo: { token: '', clientId: '', scopes: [], extra: { ownerId: OWNER_ID } } },
  );
  return JSON.parse((await response.text()).split('data: ')[1] ?? '{}');
}
