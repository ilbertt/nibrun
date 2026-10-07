import { publicSchema } from '@repo/typebox-extensions';
import { t } from 'elysia';
import { SqliteConnectionSchema } from '#lib/api/sqlite-connection.ts';

export const CreateSqliteConnectionSchema = publicSchema(
  t.Pick(SqliteConnectionSchema, ['sqlite_file_path']),
);
export const SqliteConnectionResponseSchema = publicSchema(SqliteConnectionSchema);
export const ListSqliteConnectionsResponseSchema = t.Object({
  connections: t.Array(SqliteConnectionResponseSchema),
});
