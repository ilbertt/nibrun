import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import {
  renderSqliteConnection,
  type SqliteConnection,
  SqliteConnectionSchema,
} from '#lib/sqlite/connections.ts';

type PipelineRoute = ReturnType<
  PublicApiClient['api']['sqlite']['connections']
>['v2']['pipeline']['post'];
export type PipelineResponse = NonNullable<Awaited<ReturnType<PipelineRoute>>['data']>;
type StreamResponse = Extract<PipelineResponse['results'][number], { type: 'ok' }>['response'];
type StatementResult = Extract<StreamResponse, { type: 'execute' }>['result'];
type SqliteValue = StatementResult['rows'][number][number];

const CellSchema = z.union([z.string(), z.number(), z.null(), z.object({ base64: z.string() })]);
const QuerySchema = z.object({
  connection: SqliteConnectionSchema,
  columns: z.array(z.string().nullable()),
  rows: z.array(z.array(CellSchema)),
});
type Cell = z.output<typeof CellSchema>;
type Query = z.output<typeof QuerySchema>;

export const SQLITE_QUERY_OUTPUT = defineOutput({
  schema: QuerySchema,
  render: function render({ value, out }) {
    renderSqliteConnection({ value: value.connection, out });
    for (const line of renderSqliteRows(value)) {
      out.info(line);
    }
    out.dim(`${value.rows.length} ${value.rows.length === 1 ? 'row' : 'rows'}.`);
  },
});

export async function querySqlite({
  api,
  connection,
  sql,
}: {
  api: PublicApiClient;
  connection: SqliteConnection;
  sql: string;
}): Promise<Query> {
  const response = unwrap(
    await api.api.sqlite.connections({ connectionId: connection.id }).v2.pipeline.post({
      baton: null,
      requests: [{ type: 'execute', stmt: { sql, want_rows: true } }, { type: 'close' }],
    }),
  );
  const result = statementResult(response);
  return {
    connection,
    columns: result.cols.map(function columnName(column) {
      return column.name;
    }),
    rows: result.rows.map(function decodeRow(values) {
      return values.map(decodeSqliteValue);
    }),
  };
}

function statementResult(response: PipelineResponse): StatementResult {
  const [execution, closing] = response.results;
  if (execution?.type === 'error') {
    throw new UsageError(sqliteError(execution.error));
  }
  if (closing?.type === 'error') {
    throw new UsageError(sqliteError(closing.error));
  }
  if (
    execution?.type !== 'ok' ||
    execution.response.type !== 'execute' ||
    closing?.type !== 'ok' ||
    closing.response.type !== 'close' ||
    response.baton !== null
  ) {
    throw new UsageError('The API returned an unexpected SQLite query response.');
  }
  return execution.response.result;
}

function sqliteError(
  error: Extract<PipelineResponse['results'][number], { type: 'error' }>['error'],
): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

function decodeSqliteValue(value: SqliteValue): Cell {
  switch (value.type) {
    case 'null':
      return null;
    case 'integer':
    case 'float':
    case 'text':
      return value.value;
    case 'blob':
      return { base64: value.base64 };
  }
}

export function renderSqliteRows({ columns, rows }: Pick<Query, 'columns' | 'rows'>): string[] {
  if (columns.length === 0) {
    return [];
  }
  const headings = columns.map(function heading(name) {
    return name === null ? '(unnamed)' : escapedText(name);
  });
  const renderedRows = rows.map(function row(values) {
    return values.map(renderCell);
  });
  const table = [headings, ...renderedRows];
  const widths = Array.from(headings.entries(), function width([index, heading]) {
    return Math.max(
      heading.length,
      ...renderedRows.map(function length(row) {
        return row[index]?.length ?? 0;
      }),
    );
  });
  return table.map(function line(row) {
    return Array.from(row.entries(), function padded([index, cell]) {
      return cell.padEnd(widths[index] ?? 0);
    })
      .join('  ')
      .trimEnd();
  });
}

function renderCell(value: Cell): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'object') {
    return `base64:${value.base64}`;
  }
  return typeof value === 'string' ? escapedText(value) : String(value);
}

function escapedText(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}
