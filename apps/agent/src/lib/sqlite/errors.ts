import { Data } from 'effect';

export class InvalidSqliteRequest extends Data.TaggedError('InvalidSqliteRequest') {
  override get message() {
    return 'The SQLite request exceeds the guest protocol limits.';
  }
}

export class MalformedSqliteReply extends Data.TaggedError('MalformedSqliteReply') {
  override get message() {
    return 'The guest sent an invalid SQLite response.';
  }
}

export class SqliteDisconnected extends Data.TaggedError('SqliteDisconnected') {
  override get message() {
    return 'The guest SQLite connection closed before responding.';
  }
}

export class GuestSqliteFailed extends Data.TaggedError('GuestSqliteFailed')<{
  readonly code: string;
  readonly reason: string;
}> {
  override get message() {
    return this.reason;
  }
}
