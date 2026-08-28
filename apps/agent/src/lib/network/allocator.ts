import { type AppId, AppIdSchema, Value } from '@repo/protocol';
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

/**
 * Where the next scan starts. A hint and never an authority: the scan only ever returns a slot
 * nothing holds, so a cursor that is stale, missing or nonsense costs a different free slot rather
 * than a wrong one.
 */
export function readSlotCursor(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : FIRST_SLOT;
}

export function assignmentsFrom(records: SlotRecords): Assignments {
  const assignments = new Map<AppId, number>();
  const taken = new Set<number>();
  for (const [appId, slot] of Object.entries(records)) {
    if (slot < FIRST_SLOT || slot >= SLOT_COUNT || taken.has(slot)) {
      continue;
    }
    assignments.set(Value.Parse(AppIdSchema, appId), slot);
    taken.add(slot);
  }
  return assignments;
}
