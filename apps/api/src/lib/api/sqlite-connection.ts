import { AppIdSchema, GuestPathSchema, TimestampSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { SqliteConnectionIdSchema } from '#lib/api/identifiers.ts';

export const SqliteConnectionSchema = Type.Object({
  id: SqliteConnectionIdSchema,
  appId: AppIdSchema,
  sqlite_file_path: GuestPathSchema,
  createdAt: TimestampSchema,
  url: Type.String({ format: 'uri' }),
});
export type SqliteConnection = typeof SqliteConnectionSchema.static;
