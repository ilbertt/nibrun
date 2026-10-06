import { type Timestamp, TimestampSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Clock, Effect } from 'effect';

export const fromEpochMs = (value: number): Timestamp =>
  Value.Parse(TimestampSchema, new Date(value).toISOString());

export const toEpochMs = (value: Timestamp): number => Date.parse(value);

export const nowTimestamp = Effect.map(Clock.currentTimeMillis, fromEpochMs);
