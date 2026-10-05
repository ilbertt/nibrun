import { t } from 'elysia';

export const SqliteConnectionIdSchema = t.String({ minLength: 1, maxLength: 128 });
export const SqliteConnectionParamsSchema = t.Object({ selectionId: SqliteConnectionIdSchema });
