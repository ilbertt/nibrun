import { expect, test } from 'bun:test';
import { CNAME_RECORD_TYPE } from '@repo/protocol';
import { DnsRepository } from '#repositories/dns.repository.ts';

test('only accepts CNAME answers owned by the queried name and normalizes targets', async () => {
  let requestedHostname: string | undefined;
  const repository = new DnsRepository({
    queryCname({ hostname }) {
      requestedHostname = hostname;
      return Promise.resolve([
        { name: 'APP.EXAMPLE.DEV.', type: CNAME_RECORD_TYPE.code, data: 'First.Example.com.' },
        { name: 'first.example.com.', type: CNAME_RECORD_TYPE.code, data: 'expected.example.com.' },
        { name: 'app.example.dev.', type: 1, data: '192.0.2.1' },
      ]);
    },
  });

  expect(await repository.cnameTargets({ hostname: 'app.example.dev' })).toEqual([
    'first.example.com',
  ]);
  expect(requestedHostname).toBe('app.example.dev');
});
