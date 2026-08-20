import type { ISelectHealthPingResult } from '#db/queries.gen.ts';
import { Repository } from '#repositories/repository.ts';

export class HealthRepository extends Repository {
  async ping(): Promise<ISelectHealthPingResult[]> {
    return await this.sql.SelectHealthPing`SELECT 1 AS ok`;
  }
}
