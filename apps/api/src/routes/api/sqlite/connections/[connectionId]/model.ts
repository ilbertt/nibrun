import { publicSchema } from '@repo/typebox-extensions';
import { SqliteConnectionSchema } from '#lib/api/sqlite-connection.ts';

export const SqliteConnectionResponseSchema = publicSchema(SqliteConnectionSchema);
