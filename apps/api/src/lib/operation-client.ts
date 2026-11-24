import { HttpOperationClient, OPERATION_CLIENT_HEADER } from '@repo/api-constants';

export type OperationClient = `${HttpOperationClient}` | 'mcp' | 'system' | 'unknown';
export type OperationAttribution = { client: OperationClient };

export function httpOperationClient(request: Request): OperationClient {
  const client = request.headers.get(OPERATION_CLIENT_HEADER);
  return client === HttpOperationClient.Dashboard || client === HttpOperationClient.Cli
    ? client
    : 'unknown';
}
