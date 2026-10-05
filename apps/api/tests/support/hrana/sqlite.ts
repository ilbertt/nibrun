import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type {
  SqliteDescribeResult,
  SqliteStatement,
  SqliteStatementResult,
  SqliteValue,
} from '@repo/protocol';
import { HranaError } from '#lib/hrana/errors.ts';
import { SqliteExecutorContract } from '#lib/hrana/executor.ts';

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
  }): Promise<SqliteStatementResult> {
    signal.throwIfAborted();
    const prepared = prepareSql({ database: this.#database, sql: statement.sql });
    try {
      const bindings =
        statement.namedArgs.length > 0
          ? [
              Object.fromEntries(
                statement.namedArgs.map(function binding(argument) {
                  const name = /^[:$@]/.test(argument.name) ? argument.name : `:${argument.name}`;
                  return [name, fromValue(argument.value)];
                }),
              ),
            ]
          : statement.args.map(fromValue);
      const rows = prepared.values(...(bindings as SQLQueryBindings[]));
      const columns = Array.from(
        prepared.columnNames.entries(),
        function describeColumn([index, name]) {
          const declaredType = prepared.declaredTypes[index];
          return declaredType == null ? { name } : { name, declaredType };
        },
      );
      return Promise.resolve({
        columns,
        rows: statement.wantRows
          ? rows.map(function row(values) {
              return values.map(toValue);
            })
          : [],
        affectedRowCount: 0,
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

  override describe({ sql }: { sql: string; signal: AbortSignal }): Promise<SqliteDescribeResult> {
    const prepared = this.#database.prepare(sql);
    try {
      return Promise.resolve({
        parameters: Array.from({ length: prepared.paramsCount }, function parameter() {
          return {};
        }),
        columns: prepared.columnNames.map(function describeColumn(name) {
          return { name };
        }),
        isExplain: false,
        isReadonly: true,
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

function fromValue(value: SqliteValue): SQLQueryBindings {
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

function toValue(value: unknown): SqliteValue {
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
