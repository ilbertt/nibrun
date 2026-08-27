import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type { Queries } from '#db/queries.gen.ts';
import type { VictoriaLogsHealth } from '#lib/victorialogs/client.ts';
import { Repository } from '#repositories/repository.ts';

/** Listing is what proves the bucket is there and these credentials reach it; the keys are not read. */
const PROBE_KEY_LIMIT = 1;

export type LogStoreProbe = Pick<VictoriaLogsHealth, 'check'>;
export type ObjectStoreProbe = Pick<Bun.S3Client, 'list'>;

export abstract class HealthRepositoryContract {
  abstract pingDatabase(): Promise<void>;
  abstract pingLogStore(): Promise<void>;
  abstract pingObjectStore(): Promise<void>;
}

/**
 * Whether each thing the api depends on answers. One repository rather than a probe bolted onto
 * each dependency's own: reachability is not what those repositories are for, and asking it of
 * them would put a method on every contract that only this reads.
 *
 * Each probe returns nothing and throws when the dependency is unreachable — there is no degree
 * of reachable, and a caller that has to read a boolean to find out is one that can forget to.
 */
export class HealthRepository extends Repository implements HealthRepositoryContract {
  readonly #logStore: LogStoreProbe;
  readonly #objectStore: ObjectStoreProbe;

  constructor({
    sql,
    logStore,
    objectStore,
  }: {
    sql: TypedSQL<Queries>;
    logStore: LogStoreProbe;
    objectStore: ObjectStoreProbe;
  }) {
    super(sql);
    this.#logStore = logStore;
    this.#objectStore = objectStore;
  }

  async pingDatabase(): Promise<void> {
    await this.sql.SelectHealthPing`SELECT 1 AS ok`;
  }

  async pingLogStore(): Promise<void> {
    await this.#logStore.check();
  }

  async pingObjectStore(): Promise<void> {
    await this.#objectStore.list({ maxKeys: PROBE_KEY_LIMIT });
  }
}
