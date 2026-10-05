import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { CNAME_RECORD_TYPE } from '#domain/dns.ts';
import { CloudflareDnsClient } from '#lib/cloudflare-dns/client.ts';
import { DnsRepository } from '#repositories/dns.repository.ts';

afterEach(() => {
  mock.restore();
});

test('only accepts CNAME answers owned by the queried name and normalizes targets', async () => {
  const client = new CloudflareDnsClient();
  spyOn(client, 'queryCname').mockResolvedValue([
    { name: 'APP.EXAMPLE.DEV.', type: CNAME_RECORD_TYPE.code, data: 'First.Example.com.' },
    { name: 'first.example.com.', type: CNAME_RECORD_TYPE.code, data: 'expected.example.com.' },
    { name: 'app.example.dev.', type: 1, data: '192.0.2.1' },
  ]);
  const repository = new DnsRepository(client);

  expect(await repository.cnameTargets({ hostname: 'app.example.dev' })).toEqual([
    'first.example.com',
  ]);
});
