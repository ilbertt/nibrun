import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { UMAMI_WEBSITE_ID } from '@repo/analytics/config';
import { UmamiRepository } from '#repositories/umami.repository.ts';
import { ANALYTICS_INPUT } from '#tests/support/analytics.ts';

const ENDPOINT = new URL('https://analytics.example.test/api/send');
const HOSTNAME = 'api.example.test';

function repository() {
  return new UmamiRepository({ endpoint: ENDPOINT, hostname: HOSTNAME });
}

afterEach(function restoreMocks() {
  mock.restore();
});

test('sends only the event contract and opaque account identity to the shared website', async () => {
  const send = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null));
  await repository().send(ANALYTICS_INPUT);
  expect(send).toHaveBeenCalledTimes(1);
  const [url, options] = send.mock.calls[0]!;
  expect(url).toEqual(ENDPOINT);
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json', 'user-agent': 'nibrun/1.0' },
  });
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.parse(String(options?.body))).toEqual({
    type: 'event',
    payload: {
      website: UMAMI_WEBSITE_ID,
      hostname: HOSTNAME,
      url: '/mcp',
      id: ANALYTICS_INPUT.ownerId,
      name: ANALYTICS_INPUT.event.name,
      data: {
        ...ANALYTICS_INPUT.event.data,
        source: 'mcp',
        site: 'api',
        account_id: ANALYTICS_INPUT.ownerId,
      },
    },
  });
});

test('does not send analytics without an explicitly configured endpoint', async () => {
  const send = spyOn(globalThis, 'fetch');
  await new UmamiRepository({ endpoint: undefined, hostname: HOSTNAME }).send(ANALYTICS_INPUT);
  expect(send).not.toHaveBeenCalled();
});
