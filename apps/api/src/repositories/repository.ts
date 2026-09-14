import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { ArrayType } from 'bun';
import type { Queries } from '#db/queries.gen.ts';

/**
 * `sql.array` encodes as JSON when the element type is left out, and `text[]` reads that JSON
 * back element by element — so the values would arrive quoted rather than rejected. Naming the
 * type is what makes the column and the parameter agree.
 */
export const TEXT_ARRAY: ArrayType = 'TEXT';

export abstract class Repository {
  protected readonly sql: TypedSQL<Queries>;

  constructor(sql: TypedSQL<Queries>) {
    this.sql = sql;
  }
}
