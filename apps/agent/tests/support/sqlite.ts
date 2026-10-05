import { Buffer } from 'node:buffer';

export const SQLITE_HEADER_BYTES = 9;
export const SQLITE_CODE_OFFSET = 4;
export const SQLITE_LENGTH_OFFSET = 5;
export const SQLITE_UINT32_BYTES = 4;
export const SQLITE_INT64_BYTES = 8;
export const SQLITE_INT64_MAX = 9223372036854775807n;
export const SQLITE_REPLY = { ok: 128, result: 129, error: 255 } as const;

export function sqliteFrame({ code, body }: { code: number; body: Buffer }) {
  const header = Buffer.alloc(SQLITE_HEADER_BYTES);
  header.write('NBS1');
  header[SQLITE_CODE_OFFSET] = code;
  header.writeUInt32BE(body.byteLength, SQLITE_LENGTH_OFFSET);
  return Buffer.concat([header, body]);
}

export function sqliteField(value: string | Buffer) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(SQLITE_UINT32_BYTES);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

export function sqliteInteger(value: bigint) {
  const bytes = Buffer.alloc(SQLITE_HEADER_BYTES);
  bytes[0] = 1;
  bytes.writeBigInt64BE(value, 1);
  return bytes;
}

export function sqliteResultFrame() {
  const counts = Buffer.alloc(SQLITE_UINT32_BYTES);
  counts.writeUInt32BE(1);
  const footer = Buffer.alloc(SQLITE_INT64_BYTES * 2 + 1);
  footer[SQLITE_INT64_BYTES * 2] = 1;
  return sqliteFrame({
    code: SQLITE_REPLY.result,
    body: Buffer.concat([
      counts,
      sqliteField('value'),
      sqliteField('INTEGER'),
      counts,
      sqliteInteger(SQLITE_INT64_MAX),
      footer,
    ]),
  });
}
