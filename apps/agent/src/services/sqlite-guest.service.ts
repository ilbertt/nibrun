import { Effect } from 'effect';
import { makeNibrunnerSqliteGuest } from '#lib/nibrunner/sqlite-guest.ts';
import { NibrunnerGuestConnections } from '#services/nibrunner-guest-connections.service.ts';

export class SqliteGuest extends Effect.Service<SqliteGuest>()('SqliteGuest', {
  effect: makeNibrunnerSqliteGuest,
  dependencies: [NibrunnerGuestConnections.Default],
}) {}
