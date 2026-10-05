import {
  type AppId,
  type DeploymentId,
  type GuestPath,
  type HostId,
  type SqliteOperation,
  type SqliteOutcome,
  SqliteOutcomeSchema,
  type SqliteQuery,
  SqliteSessionIdSchema,
  type SqliteStatement,
  Value,
} from '@repo/protocol';
import { HranaError } from '#lib/hrana/errors.ts';
import { SqliteExecutorContract } from '#lib/hrana/executor.ts';
import type { SqliteRelayService } from '#services/sqlite-relay.service.ts';

const OPERATION_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;

type SqliteRelayServiceContract = Pick<SqliteRelayService, 'execute'>;
type SessionAddress = Pick<SqliteQuery, 'appId' | 'deploymentId' | 'sessionId'>;

export async function openRemoteSqliteExecutor({
  relay,
  appId,
  deploymentId,
  path,
  signal,
}: {
  relay: SqliteRelayServiceContract;
  appId: AppId;
  deploymentId: DeploymentId;
  path: GuestPath;
  signal: AbortSignal;
}): Promise<SqliteExecutorContract> {
  signal.throwIfAborted();
  const sessionId = Value.Parse(SqliteSessionIdSchema, crypto.randomUUID());
  // An abandoned open still needs the host's answer so its newly created session can be closed.
  const opening = relay
    .execute({
      appId,
      deploymentId,
      sessionId,
      operation: { type: 'open', path },
      targetHostId: undefined,
      signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS),
    })
    .then(async function opened(answer) {
      const executor = new RemoteSqliteExecutor({
        relay,
        appId,
        deploymentId,
        sessionId,
        hostId: answer.hostId,
      });
      try {
        requireOutcome({ outcome: answer.outcome, status: 'opened' });
      } catch (error) {
        if (error instanceof HranaError && error.code === 'PROTO_ERROR') {
          await executor.close().catch(function cleanupFailed() {});
        }
        throw error;
      }
      if (signal.aborted) {
        await executor.close();
        signal.throwIfAborted();
      }
      return executor;
    });
  return await waitForCaller({ opening, signal });
}

class RemoteSqliteExecutor extends SqliteExecutorContract {
  readonly #relay: SqliteRelayServiceContract;
  readonly #address: SessionAddress;
  readonly #hostId: HostId;
  #closing: Promise<void> | undefined;

  constructor({
    relay,
    hostId,
    ...address
  }: SessionAddress & { relay: SqliteRelayServiceContract; hostId: HostId }) {
    super();
    this.#relay = relay;
    this.#address = address;
    this.#hostId = hostId;
  }

  override async execute({
    statement,
    signal,
  }: {
    statement: SqliteStatement;
    signal: AbortSignal;
  }) {
    const outcome = await this.#request({
      operation: { type: 'execute', statement },
      status: 'executed',
      signal,
    });
    return outcome.result;
  }

  override async describe({ sql, signal }: { sql: string; signal: AbortSignal }) {
    const outcome = await this.#request({
      operation: { type: 'describe', sql },
      status: 'described',
      signal,
    });
    return outcome.result;
  }

  override async sequence({ sql, signal }: { sql: string; signal: AbortSignal }): Promise<void> {
    await this.#request({ operation: { type: 'sequence', sql }, status: 'sequenced', signal });
  }

  override close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    const answer = await this.#relay.execute({
      ...this.#address,
      operation: { type: 'close' },
      targetHostId: this.#hostId,
      signal: AbortSignal.timeout(CLOSE_TIMEOUT_MS),
    });
    requireOutcome({ outcome: answer.outcome, status: 'closed' });
  }

  async #request<Status extends SqliteOutcome['status']>({
    operation,
    status,
    signal,
  }: {
    operation: SqliteOperation;
    status: Status;
    signal: AbortSignal;
  }): Promise<Extract<SqliteOutcome, { status: Status }>> {
    if (this.#closing) {
      throw new HranaError({ message: 'SQLite stream is closed', code: 'STREAM_CLOSED' });
    }
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(OPERATION_TIMEOUT_MS)]);
    try {
      const answer = await this.#relay.execute({
        ...this.#address,
        operation,
        targetHostId: this.#hostId,
        signal: deadline,
      });
      return requireOutcome({ outcome: answer.outcome, status });
    } catch (error) {
      if (error instanceof HranaError && error.code.startsWith('SQLITE_') && !deadline.aborted) {
        throw error;
      }
      await this.close().catch(function cleanupFailed() {});
      signal.throwIfAborted();
      if (error instanceof HranaError) {
        throw error;
      }
      throw new HranaError({ message: 'SQLite host did not answer', code: 'SQLITE_UNAVAILABLE' });
    }
  }
}

function requireOutcome<Status extends SqliteOutcome['status']>({
  outcome,
  status,
}: {
  outcome: SqliteOutcome;
  status: Status;
}): Extract<SqliteOutcome, { status: Status }> {
  if (!Value.Check(SqliteOutcomeSchema, outcome)) {
    throw new HranaError({
      message: 'SQLite host returned an invalid result',
      code: 'PROTO_ERROR',
    });
  }
  if (outcome.status === 'failed') {
    throw new HranaError({ message: outcome.message, code: outcome.code });
  }
  if (outcome.status !== status) {
    throw new HranaError({
      message: 'SQLite host returned an unexpected result',
      code: 'PROTO_ERROR',
    });
  }
  return outcome as Extract<SqliteOutcome, { status: Status }>;
}

async function waitForCaller({
  opening,
  signal,
}: {
  opening: Promise<SqliteExecutorContract>;
  signal: AbortSignal;
}): Promise<SqliteExecutorContract> {
  const { promise, resolve, reject } = Promise.withResolvers<SqliteExecutorContract>();
  function abort() {
    reject(signal.reason);
  }
  signal.addEventListener('abort', abort, { once: true });
  void opening.then(
    function ready(executor) {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) {
        void executor.close().then(function closed() {
          reject(signal.reason);
        }, reject);
      } else {
        resolve(executor);
      }
    },
    function failed(error) {
      signal.removeEventListener('abort', abort);
      reject(error);
    },
  );
  if (signal.aborted) {
    abort();
  }
  return await promise;
}
