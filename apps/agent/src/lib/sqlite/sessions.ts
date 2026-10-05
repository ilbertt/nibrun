import {
  type DesiredInstance,
  SQLITE_MAX_ERROR_MESSAGE_LENGTH,
  type SqliteOutcome,
  type SqliteQuery,
  type SqliteSessionId,
} from '@repo/protocol';
import { Data, type Deferred, type Effect, type Scope } from 'effect';
import type { connectGuestSqlite } from '#lib/sqlite/client.ts';
import type {
  GuestSqliteFailed,
  InvalidSqliteRequest,
  MalformedSqliteReply,
  SqliteDisconnected,
} from '#lib/sqlite/errors.ts';

export const SQLITE_SESSION_IDLE_TIMEOUT_MS = 30_000;
export const SQLITE_MAX_GUEST_SESSIONS = 4;
export const SQLITE_MAX_HOST_SESSIONS = 128;

export class SqliteSessionUnavailable extends Data.TaggedError('SqliteSessionUnavailable') {
  override get message() {
    return 'The SQLite session is unavailable for the current deployment.';
  }
}

export class SqliteSessionCapacity extends Data.TaggedError('SqliteSessionCapacity') {
  override get message() {
    return 'The guest has no available SQLite connection.';
  }
}

export type SqliteSessionError =
  | GuestSqliteFailed
  | InvalidSqliteRequest
  | MalformedSqliteReply
  | SqliteDisconnected
  | SqliteSessionUnavailable
  | SqliteSessionCapacity;
export type SqliteClient = Effect.Effect.Success<ReturnType<typeof connectGuestSqlite>>;
export type SqliteSession = {
  readonly appId: SqliteQuery['appId'];
  readonly deploymentId: SqliteQuery['deploymentId'];
  readonly scope: Scope.CloseableScope;
  readonly ready: Deferred.Deferred<SqliteClient, SqliteSessionError>;
  readonly touched: number;
};
export type SqliteSessionExpiry = {
  readonly session: SqliteSession | undefined;
  readonly expired: boolean;
};
export type SqliteRegistry = {
  readonly deployments: ReadonlyMap<DesiredInstance['appId'], DesiredInstance['deploymentId']>;
  readonly sessions: ReadonlyMap<SqliteSessionId, SqliteSession>;
};

export function sqliteFailure(error: SqliteSessionError): SqliteOutcome {
  return {
    status: 'failed',
    code: error._tag === 'GuestSqliteFailed' ? `SQLITE_${error.code}` : error._tag,
    message: error.message.slice(0, SQLITE_MAX_ERROR_MESSAGE_LENGTH),
  };
}
