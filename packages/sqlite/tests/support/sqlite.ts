import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type {
  HranaDescribeResult,
  HranaStmtResult,
  HranaValue,
  SqliteStatement,
} from '@repo/sqlite';
import { HranaError, SqliteExecutorContract } from '@repo/sqlite';

export class LocalSqliteExecutor extends SqliteExecutorContract {
  readonly #database = new Database(':memory:', { safeIntegers: true });

  constructor() {
    super();
    this.#database.run(
      "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES (1, 'first'), (2, 'second')",
    );
  }

  override execute({
    statement,
    signal,
  }: {
    statement: SqliteStatement;
    signal: AbortSignal;
  }): Promise<HranaStmtResult> {
    signal.throwIfAborted();
    const prepared = prepareSql({ database: this.#database, sql: statement.sql });
    try {
      const bindings =
        statement.named_args.length > 0
          ? [
              Object.fromEntries(
                statement.named_args.map(function binding(argument) {
                  const name = /^[:$@]/.test(argument.name) ? argument.name : `:${argument.name}`;
                  return [name, fromValue(argument.value)];
                }),
              ),
            ]
          : statement.args.map(fromValue);
      const rows = prepared.values(...(bindings as SQLQueryBindings[]));
      const cols = Array.from(
        prepared.columnNames.entries(),
        function describeColumn([index, name]) {
          const decltype = prepared.declaredTypes[index];
          return { name, decltype: decltype ?? null };
        },
      );
      return Promise.resolve({
        cols,
        rows: statement.want_rows
          ? rows.map(function row(values) {
              return values.map(toValue);
            })
          : [],
        affected_row_count: 0,
        last_insert_rowid: null,
      });
    } catch (error) {
      throw new HranaError({
        message: error instanceof Error ? error.message : 'SQLite failed',
        code: 'SQLITE_ERROR',
      });
    } finally {
      prepared.finalize();
    }
  }

  override describe({ sql }: { sql: string; signal: AbortSignal }): Promise<HranaDescribeResult> {
    const prepared = this.#database.prepare(sql);
    try {
      return Promise.resolve({
        params: Array.from({ length: prepared.paramsCount }, function parameter() {
          return { name: null };
        }),
        cols: prepared.columnNames.map(function describeColumn(name) {
          return { name, decltype: null };
        }),
        is_explain: false,
        is_readonly: true,
      });
    } finally {
      prepared.finalize();
    }
  }

  override sequence({ sql, signal }: { sql: string; signal: AbortSignal }): Promise<void> {
    signal.throwIfAborted();
    this.#database.run(sql);
    return Promise.resolve();
  }

  override close(): Promise<void> {
    this.#database.close();
    return Promise.resolve();
  }
}

function fromValue(value: HranaValue): SQLQueryBindings {
  switch (value.type) {
    case 'null':
      return null;
    case 'integer':
      return BigInt(value.value);
    case 'float':
    case 'text':
      return value.value;
    case 'blob':
      return Buffer.from(value.base64, 'base64');
  }
}

function toValue(value: unknown): HranaValue {
  if (value === null) {
    return { type: 'null' };
  }
  if (typeof value === 'bigint') {
    return { type: 'integer', value: value.toString() };
  }
  if (typeof value === 'number') {
    return { type: 'float', value };
  }
  if (typeof value === 'string') {
    return { type: 'text', value };
  }
  if (value instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  }
  throw new Error('Unexpected SQLite fixture value');
}

function prepareSql({ database, sql }: { database: Database; sql: string }) {
  try {
    return database.prepare(sql);
  } catch (error) {
    throw new HranaError({
      message: error instanceof Error ? error.message : 'SQLite failed',
      code: 'SQLITE_ERROR',
    });
  }
}
