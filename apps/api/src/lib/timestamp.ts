import type { Timestamp } from '@repo/protocol';

export function toTimestamp(value: Date): Timestamp {
  return value.toISOString() as Timestamp;
}
