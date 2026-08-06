import { type Timestamp, TimestampSchema, Value } from '@repo/protocol';

export function toTimestamp(value: Date): Timestamp {
  return Value.Parse(TimestampSchema, value.toISOString());
}
