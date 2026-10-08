import type { Value } from '@libsql/client/web';

const HEX_RADIX = 16;

export function displaySqliteValue(value: Value): string | number | null {
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  return value instanceof ArrayBuffer ? `0x${blobHex(value)}` : value;
}

export function sqliteValueLiteral(value: Exclude<Value, null>): string {
  if (typeof value === 'string') {
    if (value.includes('\0')) {
      return `CAST(X'${blobHex(new TextEncoder().encode(value).buffer)}' AS TEXT)`;
    }
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (value instanceof ArrayBuffer) {
    return `X'${blobHex(value)}'`;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return '9e999';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-9e999';
  }
  return String(value);
}

function blobHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(HEX_RADIX).padStart(2, '0'),
  ).join('');
}
