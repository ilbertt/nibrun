import { expect, test } from 'bun:test';
import { CNAME_RECORD_TYPE } from '@repo/protocol';
import { CloudflareDnsClient } from '#lib/cloudflare-dns/client.ts';
import { DnsRepository } from '#repositories/dns.repository.ts';

test('only accepts CNAME answers owned by the queried name and normalizes targets', async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        Status: 0,
        Answer: [
          { name: 'APP.EXAMPLE.DEV.', type: CNAME_RECORD_TYPE.code, data: 'First.Example.com.' },
          {
            name: 'first.example.com.',
            type: CNAME_RECORD_TYPE.code,
            data: 'expected.example.com.',
          },
          { name: 'app.example.dev.', type: 1, data: '192.0.2.1' },
        ],
      });
    },
  });
  const repository = new DnsRepository(new CloudflareDnsClient({ endpoint: server.url.href }));

  try {
    expect(await repository.cnameTargets({ hostname: 'app.example.dev' })).toEqual([
      'first.example.com',
    ]);
  } finally {
    server.stop(true);
  }
});
