import { withTypes } from '@ilbertt/bun-sqlgen';
import { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { env } from '#lib/env.ts';

export const sql = withTypes<Queries>(new SQL(env.DATABASE_URL));
