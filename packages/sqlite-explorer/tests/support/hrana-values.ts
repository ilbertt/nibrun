import type { SQLQueryBindings } from 'bun:sqlite';
import type { HranaValue } from '@repo/sqlite';

export function decodeValue(value: HranaValue): SQLQueryBindings {
  switch (value.type) {
    case 'null':
      return null;
    case 'integer':
      return BigInt(value.value);
    case 'blob':
      return Buffer.from(value.base64, 'base64');
    default:
      return value.value;
  }
}

export function encodeValue(value: unknown): HranaValue {
  if (value === null) {
    return { type: 'null' };
  }
  if (typeof value === 'bigint') {
    return { type: 'integer', value: String(value) };
  }
  if (typeof value === 'number') {
    return { type: 'float', value };
  }
  if (value instanceof Uint8Array) {
    return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  }
  return { type: 'text', value: String(value) };
}
