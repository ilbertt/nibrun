import { Buffer } from 'node:buffer';
import {
  type HranaDescribeResult,
  type HranaStmtResult,
  type SqliteOperation,
  SqliteOperationSchema,
  Value,
} from '@repo/protocol';
import { Either, Option } from 'effect';
import { InvalidSqliteRequest, MalformedSqliteReply } from '#lib/sqlite/errors.ts';
import {
  encodeSqliteCount,
  encodeSqliteField,
  encodeSqliteValue,
  SqliteReplyReader,
} from '#lib/sqlite/value-codec.ts';

// NBS1 matches apps/runtime/src/guest-sqlite.h.
export const GUEST_SQLITE_VSOCK_PORT = 51005;
const MAGIC = Buffer.from('NBS1');
const CODE_OFFSET = MAGIC.byteLength;
const LENGTH_OFFSET = CODE_OFFSET + 1;
const UINT32_BYTES = 4;
const HEADER_BYTES = LENGTH_OFFSET + UINT32_BYTES;
const CONNECT_PREFIX = 'OK ';
const UINT32_MAX = 0xffffffff;
const MAX_BODY_BYTES = 65536;
const MAX_CONNECT_BYTES = 64;
const REQUEST_CODES = { open: 0, execute: 1, describe: 2, sequence: 3, close: 4 } as const;
const RESPONSE_CODES = { ok: 128, result: 129, description: 130, error: 255 } as const;

export type SqliteGuestReply =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'result';
      readonly result: HranaStmtResult;
      readonly autocommit: boolean;
    }
  | { readonly kind: 'description'; readonly description: HranaDescribeResult }
  | { readonly kind: 'error'; readonly code: number; readonly message: string };

function requestBody(operation: SqliteOperation) {
  switch (operation.type) {
    case 'open':
      return Buffer.from(operation.path);
    case 'describe':
    case 'sequence':
      return Buffer.from(operation.sql);
    case 'close':
      return Buffer.alloc(0);
    case 'execute': {
      const statement = operation.statement;
      const params = [
        ...statement.args.map((value) => ({ name: '', value })),
        ...statement.named_args,
      ];
      const chunks: Buffer[] = [
        encodeSqliteField(statement.sql),
        Buffer.of(statement.want_rows ? 1 : 0),
        encodeSqliteCount(params.length),
      ];
      let length = 0;
      for (const chunk of chunks) {
        length += chunk.byteLength;
      }
      for (const parameter of params) {
        const name = encodeSqliteField(parameter.name);
        const value = encodeSqliteValue(parameter.value);
        length += name.byteLength + value.byteLength;
        if (length > MAX_BODY_BYTES) {
          throw new InvalidSqliteRequest();
        }
        chunks.push(name, value);
      }
      return Buffer.concat(chunks);
    }
  }
}

export function encodeSqliteRequest(operation: SqliteOperation) {
  return Either.try({
    try: () => {
      if (!Value.Check(SqliteOperationSchema, operation)) {
        throw new InvalidSqliteRequest();
      }
      const body = requestBody(operation);
      if (body.byteLength > MAX_BODY_BYTES) {
        throw new InvalidSqliteRequest();
      }
      const header = Buffer.alloc(HEADER_BYTES);
      MAGIC.copy(header);
      header[CODE_OFFSET] = REQUEST_CODES[operation.type];
      header.writeUInt32BE(body.byteLength, LENGTH_OFFSET);
      return Buffer.concat([header, body]);
    },
    catch: () => new InvalidSqliteRequest(),
  });
}

function parseReply({ code, body }: { code: number; body: Buffer }) {
  const reader = new SqliteReplyReader(body);
  let reply: SqliteGuestReply;
  switch (code) {
    case RESPONSE_CODES.ok:
      reply = { kind: 'ok' };
      break;
    case RESPONSE_CODES.result:
      reply = { kind: 'result', ...reader.result() };
      break;
    case RESPONSE_CODES.description:
      reply = { kind: 'description', description: reader.description() };
      break;
    case RESPONSE_CODES.error:
      reply = { kind: 'error', ...reader.error() };
      break;
    default:
      throw new MalformedSqliteReply();
  }
  reader.finished();
  return reply;
}

export function decodeSqliteReply({ buffered, chunk }: { buffered: Buffer; chunk: Uint8Array }) {
  return Either.try({
    try: () => {
      if (buffered.byteLength + chunk.byteLength > HEADER_BYTES + MAX_BODY_BYTES) {
        throw new MalformedSqliteReply();
      }
      const bytes = Buffer.concat([buffered, chunk]);
      if (bytes.byteLength < HEADER_BYTES) {
        return { buffered: bytes, reply: Option.none<SqliteGuestReply>() };
      }
      const length = bytes.readUInt32BE(LENGTH_OFFSET);
      const code = bytes[CODE_OFFSET];
      if (
        !bytes.subarray(0, CODE_OFFSET).equals(MAGIC) ||
        length > MAX_BODY_BYTES ||
        code === undefined
      ) {
        throw new MalformedSqliteReply();
      }
      if (bytes.byteLength < HEADER_BYTES + length) {
        return { buffered: bytes, reply: Option.none<SqliteGuestReply>() };
      }
      if (bytes.byteLength !== HEADER_BYTES + length) {
        throw new MalformedSqliteReply();
      }
      return {
        buffered: Buffer.alloc(0),
        reply: Option.some(parseReply({ code, body: bytes.subarray(HEADER_BYTES) })),
      };
    },
    catch: () => new MalformedSqliteReply(),
  });
}

export function decodeSqliteConnect({ buffered, chunk }: { buffered: Buffer; chunk: Uint8Array }) {
  return Either.try({
    try: () => {
      const bytes = Buffer.concat([buffered, chunk]);
      if (bytes.byteLength > MAX_CONNECT_BYTES) {
        throw new MalformedSqliteReply();
      }
      const text = bytes.toString();
      if (!text.includes('\n')) {
        return { buffered: bytes, connected: false };
      }
      if (!/^OK [0-9]{1,10}\n$/.test(text)) {
        throw new MalformedSqliteReply();
      }
      const port = Number(text.slice(CONNECT_PREFIX.length, -1));
      if (port < 1 || port > UINT32_MAX) {
        throw new MalformedSqliteReply();
      }
      return { buffered: Buffer.alloc(0), connected: true };
    },
    catch: () => new MalformedSqliteReply(),
  });
}
