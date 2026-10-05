import { expect, mock, test } from 'bun:test';
import { checkDomainDns, domainDnsPrompt } from '#domains.ts';
import { apiHolding } from '#tests/support/api.ts';

test('DNS checks request fresh results after a record becomes visible', async () => {
  const records = [
    { hostname: 'app.example.com', type: 'CNAME' as const, target: 'quiet-otter.nibrun.app' },
    {
      hostname: '_acme-challenge.app.example.com',
      type: 'CNAME' as const,
      target: 'delegation.example.net',
    },
  ];
  const responses = [false, true].map((matched) => ({
    records: records.map((record) => ({
      ...record,
      matched,
      observedTargets: matched ? [record.target] : [],
    })),
  }));
  const get = mock(() => Promise.resolve({ data: responses.shift(), error: null }));
  const input = {
    api: apiHolding({ underApp: () => ({ hostnames: { dns: { get } } }) }),
    appId: 'app-1',
    hostname: 'app.example.com',
  };
  const initial = await checkDomainDns(input);
  const refreshed = await checkDomainDns(input);
  expect(initial.records.every((record) => record.matched === false)).toBe(true);
  expect(refreshed.records.every((record) => record.matched === true)).toBe(true);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenNthCalledWith(1, {
    fetch: { cache: 'no-store' },
    query: { hostname: input.hostname },
  });
  expect(get).toHaveBeenNthCalledWith(2, {
    fetch: { cache: 'no-store' },
    query: { hostname: input.hostname },
  });
});

test('the agent prompt carries routing and certificate records and asks for the DNS provider', () => {
  const records = [
    { hostname: 'app.example.com', type: 'CNAME' as const, target: 'quiet-otter.nibrun.app' },
    {
      hostname: '_acme-challenge.app.example.com',
      type: 'CNAME' as const,
      target: 'delegation.example.net',
    },
  ];
  const prompt = domainDnsPrompt(records);
  for (const record of records) {
    expect(prompt).toContain(`${record.type} ${record.hostname} → ${record.target}`);
  }
  expect(prompt).toContain("Ask me who my domain's DNS provider is");
  expect(prompt).toContain('guide me through');
});
