import { bunSqlAdapter } from '@ilbertt/better-auth-bun-sql';
import { sql } from '#db/client.ts';

const AUTH_SCHEMA = 'auth';

export const authDatabase = bunSqlAdapter({ sql, pgSchema: AUTH_SCHEMA });
