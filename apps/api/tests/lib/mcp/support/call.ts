import type { PublicApiClient } from '@repo/api-client/public';
import { createNibrunMcpHandler } from '#lib/mcp/handler.ts';

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
  api,
  body,
}: {
  api: PublicApiClient;
  body: unknown;
}): Promise<Replied> {
  const handler = createNibrunMcpHandler({ apiFor: () => api });
  const response = await handler.fetch(
    new Request('https://nibrun.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
    { authInfo: { token: 'a-token', clientId: 'a-client', scopes: [] } },
  );
  return JSON.parse((await response.text()).split('data: ')[1] ?? '{}');
}
