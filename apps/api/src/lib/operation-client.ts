import { HttpOperationClient, OPERATION_CLIENT_HEADER } from '@repo/api-constants';

export enum OperationClient {
  Dashboard = 'dashboard',
  Cli = 'cli',
  Mcp = 'mcp',
  System = 'system',
  Unknown = 'unknown',
}

export type OperationAttribution = { client: OperationClient };

export function httpOperationClient(request: Request): OperationClient {
  switch (request.headers.get(OPERATION_CLIENT_HEADER)) {
    case HttpOperationClient.Dashboard:
      return OperationClient.Dashboard;
    case HttpOperationClient.Cli:
      return OperationClient.Cli;
    default:
      return OperationClient.Unknown;
  }
}
