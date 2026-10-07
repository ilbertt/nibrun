import { Buffer } from 'node:buffer';
import {
  type HranaDescribeResult,
  HranaDescribeResultSchema,
  HranaStmtResultSchema,
  type HranaValue,
  SQLITE_MAX_COLUMNS,
  SQLITE_MAX_PARAMETERS,
  SQLITE_MAX_ROWS,
  SQLITE_MAX_VALUE_LENGTH,
} from '@repo/sqlite';
import { Value } from '@sinclair/typebox/value';
import { InvalidSqliteRequest, MalformedSqliteReply } from '#lib/sqlite/errors.ts';

const MAX_FIELD_BYTES = SQLITE_MAX_VALUE_LENGTH;
const UINT32_BYTES = 4;
const INT64_BYTES = 8;
const SIGNED_INT64_MIN = -(1n << 63n);
const SIGNED_INT64_MAX = (1n << 63n) - 1n;
const VALUE_TAGS = { null: 0, integer: 1, float: 2, text: 3, blob: 4 } as const;

export function encodeSqliteCount(value: number) {
  const bytes = Buffer.alloc(UINT32_BYTES);
  bytes.writeUInt32BE(value);
  return bytes;
}

export function encodeSqliteField(value: string | Uint8Array) {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > MAX_FIELD_BYTES) {
    throw new InvalidSqliteRequest();
  }
  return Buffer.concat([encodeSqliteCount(bytes.byteLength), bytes]);
}

function integer(value: string) {
  const number = BigInt(value);
  if (number < SIGNED_INT64_MIN || number > SIGNED_INT64_MAX) {
    throw new InvalidSqliteRequest();
  }
  const bytes = Buffer.alloc(INT64_BYTES);
  bytes.writeBigInt64BE(number);
  return bytes;
}

export function encodeSqliteValue(value: HranaValue): Buffer {
  switch (value.type) {
    case 'null':
      return Buffer.of(VALUE_TAGS.null);
    case 'integer':
      return Buffer.concat([Buffer.of(VALUE_TAGS.integer), integer(value.value)]);
    case 'float': {
      if (!Number.isFinite(value.value)) {
        throw new InvalidSqliteRequest();
      }
      const bytes = Buffer.alloc(INT64_BYTES + 1);
      bytes[0] = VALUE_TAGS.float;
      bytes.writeDoubleBE(value.value, 1);
      return bytes;
    }
    case 'text':
      return Buffer.concat([Buffer.of(VALUE_TAGS.text), encodeSqliteField(value.value)]);
    case 'blob':
      return Buffer.concat([
        Buffer.of(VALUE_TAGS.blob),
        encodeSqliteField(Buffer.from(value.base64, 'base64')),
      ]);
  }
}

export class SqliteReplyReader {
  private offset = 0;
  constructor(private readonly bytes: Buffer) {}

  take(length: number) {
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      throw new MalformedSqliteReply();
    }
    const bytes = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  count() {
    const count = this.take(UINT32_BYTES).readUInt32BE();
    if (count > MAX_FIELD_BYTES) {
      throw new MalformedSqliteReply();
    }
    return count;
  }

  flag() {
    const value = this.take(1)[0];
    if (value !== 0 && value !== 1) {
      throw new MalformedSqliteReply();
    }
    return value === 1;
  }

  text() {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.count()));
  }

  cols(): HranaDescribeResult['cols'] {
    const count = this.count();
    if (count > SQLITE_MAX_COLUMNS) {
      throw new MalformedSqliteReply();
    }
    return Array.from({ length: count }, () => ({
      name: this.text(),
      decltype: this.text() || null,
    }));
  }

  value(): HranaValue {
    switch (this.take(1)[0]) {
      case VALUE_TAGS.null:
        return { type: 'null' };
      case VALUE_TAGS.integer:
        return { type: 'integer', value: this.take(INT64_BYTES).readBigInt64BE().toString() };
      case VALUE_TAGS.float: {
        const value = this.take(INT64_BYTES).readDoubleBE();
        if (!Number.isFinite(value)) {
          throw new MalformedSqliteReply();
        }
        return { type: 'float', value };
      }
      case VALUE_TAGS.text:
        return { type: 'text', value: this.text() };
      case VALUE_TAGS.blob:
        return { type: 'blob', base64: this.take(this.count()).toString('base64') };
      default:
        throw new MalformedSqliteReply();
    }
  }

  result() {
    const cols = this.cols();
    const rowCount = this.count();
    if (rowCount > SQLITE_MAX_ROWS || rowCount > MAX_FIELD_BYTES / Math.max(1, cols.length)) {
      throw new MalformedSqliteReply();
    }
    const rows = Array.from({ length: rowCount }, () => cols.map(() => this.value()));
    const affected = this.take(INT64_BYTES).readBigUInt64BE();
    if (affected > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MalformedSqliteReply();
    }
    const result = {
      cols,
      rows,
      affected_row_count: Number(affected),
      last_insert_rowid: this.take(INT64_BYTES).readBigInt64BE().toString(),
    };
    if (!Value.Check(HranaStmtResultSchema, result)) {
      throw new MalformedSqliteReply();
    }
    return { result, autocommit: this.flag() };
  }

  description(): HranaDescribeResult {
    const count = this.count();
    if (count > SQLITE_MAX_PARAMETERS) {
      throw new MalformedSqliteReply();
    }
    const params = Array.from({ length: count }, () => ({
      name: this.text() || null,
    }));
    const cols = this.cols();
    const description = { params, cols, is_readonly: this.flag(), is_explain: this.flag() };
    if (!Value.Check(HranaDescribeResultSchema, description)) {
      throw new MalformedSqliteReply();
    }
    return description;
  }

  error() {
    const code = this.take(UINT32_BYTES).readUInt32BE();
    const message = new TextDecoder('utf-8', { fatal: true }).decode(
      this.take(this.bytes.byteLength - this.offset),
    );
    return { code, message };
  }

  finished() {
    if (this.offset !== this.bytes.byteLength) {
      throw new MalformedSqliteReply();
    }
  }
}
