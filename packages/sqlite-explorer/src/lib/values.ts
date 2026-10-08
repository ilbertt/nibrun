import type { Value } from '@libsql/client/web';

const HEX_RADIX = 16;

export function displaySqliteValue(value: Value): string | number | null {
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  return value instanceof ArrayBuffer ? `0x${blobHex(value)}` : value;
}

function blobHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(HEX_RADIX).padStart(2, '0'),
  ).join('');
}
