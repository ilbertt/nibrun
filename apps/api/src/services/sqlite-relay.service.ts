import type { HostId, SqliteQuery, SqliteQueryRequest, SqliteQueryResult } from '@repo/protocol';
import { GatewayTimeoutError } from '#lib/errors.ts';
import { PendingSqliteQueries } from '#lib/sqlite/pending-queries.ts';
import { Service } from '#services/service.ts';

export class SqliteRelayService extends Service {
  private readonly pending = new PendingSqliteQueries();

  async execute(
    input: Omit<SqliteQuery, 'queryId'> & {
      targetHostId: HostId | undefined;
      signal: AbortSignal;
    },
  ) {
    const { answered } = this.pending.open(input);
    return await answered.catch(function unanswered() {
      throw new GatewayTimeoutError('The database host did not answer in time.');
    });
  }

  pendingQuery(input: SqliteQueryRequest & { hostId: HostId; signal: AbortSignal }) {
    return this.pending.claim(input);
  }

  acceptResult(input: SqliteQueryResult & { hostId: HostId }): void {
    if (!this.pending.answer(input)) {
      this.logger.info('SQLite result did not match a pending operation', {
        queryId: input.queryId,
        hostId: input.hostId,
      });
    }
  }
}
