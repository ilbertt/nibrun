import { withTypes } from '@ilbertt/bun-sqlgen';
import { HostIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { SQL } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

export const TEST_HOST_ID = Value.Parse(HostIdSchema, Bun.randomUUIDv7());

export async function seedReadyHost(sql: SQL): Promise<void> {
  await sql.unsafe(
    `INSERT INTO nibrun.hosts (id, origin_id, reported_state, last_seen_at)
     VALUES ($1, 'ready-test-host', 'ready', now())`,
    [TEST_HOST_ID],
  );
}

export function registerHost({ sql, originId }: { sql: SQL; originId: string }) {
  return new AgentRepository({
    sql: withTypes<Queries>(sql),
    secretsKey: TEST_SECRETS_KEY,
  }).registerHost({
    originId,
  });
}
