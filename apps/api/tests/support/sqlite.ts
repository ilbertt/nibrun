import {
  AppIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
  SqliteSessionIdSchema,
} from '@repo/protocol';
import type { HranaPipelineReqBody } from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';

export const SQLITE_DEPLOYMENT = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  deploymentId: Value.Parse(DeploymentIdSchema, 'deployment-1'),
};
export const SQLITE_SESSION_ID = Value.Parse(SqliteSessionIdSchema, 'sqlite-session-1');
export const SQLITE_HOST_ID = Value.Parse(HostIdSchema, 'host-1');
export const SQLITE_OTHER_HOST_ID = Value.Parse(HostIdSchema, 'host-2');
export const SQLITE_PIPELINE: HranaPipelineReqBody = {
  baton: null,
  requests: [
    { type: 'execute', stmt: { sql: 'SELECT 1', args: [], named_args: [], want_rows: true } },
  ],
};
