import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { Queries } from '#db/queries.gen.ts';

export abstract class Repository {
  protected readonly sql: TypedSQL<Queries>;

  constructor(sql: TypedSQL<Queries>) {
    this.sql = sql;
  }
}
