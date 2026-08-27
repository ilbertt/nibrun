import { describe, expect, test } from 'bun:test';
import { parseMessage } from '@repo/protocol';
import { StatusMap } from 'elysia';
import { GetHealthResponseSchema } from '#routes/api/health/model.ts';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

const URL = `${ORIGIN}/api/health`;

/** Through the schema the route declares, so a body that drifts from it fails here. */
async function health() {
  const response = await send({ url: URL });
  return {
    status: response.status,
    body: parseMessage({ schema: GetHealthResponseSchema, value: await response.json() }),
  };
}

/**
 * Every dependency this app was built with points at a closed port, which is the whole point:
 * the interesting answer is the one given when nothing below the api is reachable.
 */
describe('GET /api/health', () => {
  test('answers even when nothing it depends on does', async () => {
    expect((await health()).status).toBe(StatusMap.OK);
  });

  test('says which of them refused rather than only that something did', async () => {
    const { body } = await health();

    expect(body.status).toBe('degraded');
    expect(body.components.database.status).toBe('down');
    expect(body.components.logStore.status).toBe('down');
    expect(body.components.objectStore.status).toBe('down');
  });

  test('has heard from no host, so it can say nothing about one', async () => {
    const { body } = await health();

    expect(body.components.agent.status).toBe('down');
    expect(body.components.appHost.status).toBe('unknown');
  });
});
