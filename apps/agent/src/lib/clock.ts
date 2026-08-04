import type { Timestamp } from '@repo/protocol';
import { Clock, Effect } from 'effect';

export const fromEpochMs = (value: number): Timestamp => new Date(value).toISOString() as Timestamp;

export const toEpochMs = (value: Timestamp): number => Date.parse(value);

export const nowTimestamp = Effect.map(Clock.currentTimeMillis, fromEpochMs);
