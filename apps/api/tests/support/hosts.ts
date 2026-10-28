import { withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

export function registerHost({ sql, originId }: { sql: SQL; originId: string }) {
  return new AgentRepository({
    sql: withTypes<Queries>(sql),
    secretsKey: TEST_SECRETS_KEY,
  }).registerHost({
    originId,
  });
}
