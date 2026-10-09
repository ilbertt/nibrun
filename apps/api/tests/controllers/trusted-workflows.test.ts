import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import { ORIGIN, send, sendJson } from '#tests/controllers/support/api.ts';
import { trustedWorkflow } from '#tests/support/trusted-workflows.ts';

const URL = `${ORIGIN}/api/apps/app-1/trusted-workflow`;

test('trusted workflows require an account session', async () => {
  for (const response of await Promise.all([
    send({ url: URL }),
    sendJson({ method: 'PUT', url: URL, body: trustedWorkflow() }),
    send({ method: 'DELETE', url: URL }),
  ])) {
    expect(response.status).toBe(StatusMap.Unauthorized);
  }
});

test('workflow paths and invalid branch refs are refused at the HTTP boundary', async () => {
  for (const override of [{ workflow: '../deploy.yml' }, { branch: 'main..next' }]) {
    expect(
      (await sendJson({ method: 'PUT', url: URL, body: trustedWorkflow(override) })).status,
    ).toBe(StatusMap['Bad Request']);
  }
});
