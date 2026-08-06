import { type Timestamp, TimestampSchema, Value } from '@repo/protocol';
import { Clock, Effect } from 'effect';

export const fromEpochMs = (value: number): Timestamp =>
  Value.Parse(TimestampSchema, new Date(value).toISOString());

export const toEpochMs = (value: Timestamp): number => Date.parse(value);

export const nowTimestamp = Effect.map(Clock.currentTimeMillis, fromEpochMs);
