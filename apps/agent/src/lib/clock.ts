import type { Timestamp } from '@repo/protocol';

export const nowTimestamp = (): Timestamp => new Date().toISOString() as Timestamp;

export const toEpochMs = (value: Timestamp): number => Date.parse(value);

export const fromEpochMs = (value: number): Timestamp => new Date(value).toISOString() as Timestamp;
