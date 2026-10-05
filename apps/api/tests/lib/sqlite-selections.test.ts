import { expect, test } from 'bun:test';
import { GuestPathSchema, OwnerIdSchema, Value } from '@repo/protocol';
import { NotFoundError, TooManyRequestsError } from '#lib/errors.ts';
import { SqliteSelections } from '#lib/sqlite/selections.ts';
import { SQLITE_DEPLOYMENT } from '#tests/support/sqlite.ts';

const OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-1');
const OTHER_OWNER_ID = Value.Parse(OwnerIdSchema, 'owner-2');
const PATH = Value.Parse(GuestPathSchema, '/app.db');
const CREATED_MS = 1000;

function create(selections: SqliteSelections) {
  return selections.create({
    ...SQLITE_DEPLOYMENT,
    ownerId: OWNER_ID,
    path: PATH,
    nowMs: CREATED_MS,
  });
}

test('knowing a selection ID never grants another owner access', function scoped() {
  const selections = new SqliteSelections();
  const selection = create(selections);
  expect(selections.get({ id: selection.id, ownerId: OWNER_ID, nowMs: CREATED_MS })).toEqual(
    selection,
  );
  expect(function crossOwner() {
    selections.get({ id: selection.id, ownerId: OTHER_OWNER_ID, nowMs: CREATED_MS });
  }).toThrow(NotFoundError);
  expect(function crossOwnerClose() {
    selections.remove({ id: selection.id, ownerId: OTHER_OWNER_ID, nowMs: CREATED_MS });
  }).toThrow(NotFoundError);
  expect(selections.get({ id: selection.id, ownerId: OWNER_ID, nowMs: CREATED_MS }).path).toBe(
    PATH,
  );
});

test('selections expire at their deadline and can be released earlier', function expiry() {
  const selections = new SqliteSelections();
  const expired = create(selections);
  expect(function deadline() {
    selections.get({ id: expired.id, ownerId: OWNER_ID, nowMs: expired.expiresAt });
  }).toThrow(NotFoundError);
  const closed = create(selections);
  selections.remove({ id: closed.id, ownerId: OWNER_ID, nowMs: CREATED_MS });
  expect(function removed() {
    selections.get({ id: closed.id, ownerId: OWNER_ID, nowMs: CREATED_MS });
  }).toThrow(NotFoundError);
});

test('selection admission is bounded per owner and releasing one frees capacity', function capacity() {
  const selections = new SqliteSelections();
  const first = create(selections);
  let admitted = 1;
  try {
    while (true) {
      create(selections);
      admitted += 1;
    }
  } catch (error) {
    expect(error).toBeInstanceOf(TooManyRequestsError);
  }
  selections.remove({ id: first.id, ownerId: OWNER_ID, nowMs: CREATED_MS });
  expect(create(selections).id).not.toBe(first.id);
  expect(admitted).toBeGreaterThan(1);
});
