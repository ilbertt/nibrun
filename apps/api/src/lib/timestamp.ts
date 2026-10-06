import { type Timestamp, TimestampSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';

export function toTimestamp(value: Date): Timestamp {
  return Value.Parse(TimestampSchema, value.toISOString());
}
