import { Effect } from 'effect';
import { NibrunnerGuestConnections } from '#services/nibrunner-guest-connections.service.ts';
import { makeNibrunnerSqliteGuest } from '#sqlite-guest.ts';

export class SqliteGuest extends Effect.Service<SqliteGuest>()('SqliteGuest', {
  effect: makeNibrunnerSqliteGuest,
  dependencies: [NibrunnerGuestConnections.Default],
}) {}
