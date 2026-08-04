import type { AppId } from '@repo/protocol';
import { Data } from 'effect';
import { FIRST_SLOT, SLOT_COUNT } from '#lib/network/slot.ts';

export type SlotRecords = Record<string, number>;

export class SlotExhausted extends Data.TaggedError('SlotExhausted')<{
  readonly limit: number;
}> {
  override get message() {
    return `all ${this.limit} host slots are allocated`;
  }
}

export type Assignments = ReadonlyMap<AppId, number>;

export function readSlotRecords(value: unknown): SlotRecords {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, slot]) => typeof slot === 'number' && Number.isInteger(slot)),
  );
}

export function assignmentsFrom(records: SlotRecords): Assignments {
  const assignments = new Map<AppId, number>();
  const taken = new Set<number>();
  for (const [appId, slot] of Object.entries(records)) {
    if (slot < FIRST_SLOT || slot >= SLOT_COUNT || taken.has(slot)) {
      continue;
    }
    assignments.set(appId as AppId, slot);
    taken.add(slot);
  }
  return assignments;
}
