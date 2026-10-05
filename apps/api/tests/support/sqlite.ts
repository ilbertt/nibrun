import {
  AppIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
  SqliteSessionIdSchema,
  type SqliteStatement,
  Value,
} from '@repo/protocol';

export const SQLITE_DEPLOYMENT = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  deploymentId: Value.Parse(DeploymentIdSchema, 'deployment-1'),
};
export const SQLITE_SESSION_ID = Value.Parse(SqliteSessionIdSchema, 'sqlite-session-1');
export const SQLITE_HOST_ID = Value.Parse(HostIdSchema, 'host-1');
export const SQLITE_OTHER_HOST_ID = Value.Parse(HostIdSchema, 'host-2');
export const SQLITE_STATEMENT: SqliteStatement = {
  sql: 'SELECT 1',
  args: [],
  namedArgs: [],
  wantRows: true,
};
