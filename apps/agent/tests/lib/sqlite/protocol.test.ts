import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { Either, Option } from 'effect';
import {
  decodeSqliteConnect,
  decodeSqliteReply,
  encodeSqliteRequest,
} from '#lib/sqlite/protocol.ts';
import {
  SQLITE_INT64_MAX,
  SQLITE_LENGTH_OFFSET,
  SQLITE_REPLY,
  SQLITE_UINT32_BYTES,
  sqliteField,
  sqliteFrame,
  sqliteInteger,
  sqliteResultFrame,
} from '#tests/support/sqlite.ts';

const MAX_BODY_BYTES = 65536;
const UNKNOWN_REPLY_CODE = 42;
const BLOB_VALUE_TAG = 4;
const HIGHEST_BYTE = 255;

describe('SQLite guest protocol', () => {
  test('encodes positional and named values without losing integer precision', () => {
    const encoded = Either.getOrThrow(
      encodeSqliteRequest({
        type: 'execute',
        statement: {
          sql: 'SELECT ?, :blob',
          want_rows: true,
          args: [{ type: 'integer', value: '9223372036854775807' }],
          named_args: [{ name: 'blob', value: { type: 'blob', base64: 'AP8=' } }],
        },
      }),
    );
    const count = Buffer.alloc(SQLITE_UINT32_BYTES);
    count.writeUInt32BE(2);
    expect(encoded).toEqual(
      sqliteFrame({
        code: 1,
        body: Buffer.concat([
          sqliteField('SELECT ?, :blob'),
          Buffer.of(1),
          count,
          sqliteField(''),
          sqliteInteger(SQLITE_INT64_MAX),
          sqliteField('blob'),
          Buffer.of(BLOB_VALUE_TAG),
          sqliteField(Buffer.of(0, HIGHEST_BYTE)),
        ]),
      }),
    );
  });

  test('rejects integers outside SQLite range and oversized UTF-8 requests', () => {
    for (const value of ['9223372036854775808', '-9223372036854775809']) {
      expect(
        Either.isLeft(
          encodeSqliteRequest({
            type: 'execute',
            statement: {
              sql: 'SELECT ?',
              args: [{ type: 'integer', value }],
              named_args: [],
              want_rows: true,
            },
          }),
        ),
      ).toBe(true);
    }
    expect(
      Either.isLeft(encodeSqliteRequest({ type: 'sequence', sql: 'é'.repeat(MAX_BODY_BYTES) })),
    ).toBe(true);
  });

  test('decodes a fragmented result including signed 64-bit values', () => {
    let buffered = Buffer.alloc(0);
    const frame = sqliteResultFrame();
    for (const byte of frame.subarray(0, -1)) {
      const result = Either.getOrThrow(decodeSqliteReply({ buffered, chunk: Buffer.of(byte) }));
      expect(Option.isNone(result.reply)).toBe(true);
      buffered = result.buffered;
    }
    const decoded = Either.getOrThrow(decodeSqliteReply({ buffered, chunk: frame.subarray(-1) }));
    expect(Option.getOrThrow(decoded.reply)).toEqual({
      kind: 'result',
      autocommit: true,
      result: {
        cols: [{ name: 'value', decltype: 'INTEGER' }],
        rows: [[{ type: 'integer', value: '9223372036854775807' }]],
        affected_row_count: 0,
        last_insert_rowid: '0',
      },
    });
  });

  test('rejects trailing frames, unknown codes, and oversized announced frames', () => {
    const oversized = sqliteFrame({ code: SQLITE_REPLY.ok, body: Buffer.alloc(0) });
    oversized.writeUInt32BE(MAX_BODY_BYTES + 1, SQLITE_LENGTH_OFFSET);
    for (const chunk of [
      oversized,
      Buffer.concat([sqliteResultFrame(), Buffer.of(0)]),
      sqliteFrame({ code: UNKNOWN_REPLY_CODE, body: Buffer.alloc(0) }),
      sqliteFrame({ code: SQLITE_REPLY.result, body: Buffer.of(0) }),
    ]) {
      expect(Either.isLeft(decodeSqliteReply({ buffered: Buffer.alloc(0), chunk }))).toBe(true);
    }
  });

  test('rejects invalid handshake ports and extra bytes', () => {
    for (const text of ['OK 0\n', 'OK 4294967296\n', 'OK 1\nNBS1', 'ERR\n']) {
      expect(
        Either.isLeft(decodeSqliteConnect({ buffered: Buffer.alloc(0), chunk: Buffer.from(text) })),
      ).toBe(true);
    }
  });
});
