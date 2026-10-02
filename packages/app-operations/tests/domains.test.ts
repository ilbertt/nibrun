import { expect, test } from 'bun:test';
import { domainDnsPrompt } from '#domains.ts';

test('the agent prompt carries routing and certificate records and asks for the DNS provider', () => {
  const prompt = domainDnsPrompt([
    { hostname: 'app.example.com', type: 'CNAME', target: 'quiet-otter.nibrun.app' },
    {
      hostname: '_acme-challenge.app.example.com',
      type: 'CNAME',
      target: 'delegation.example.net',
    },
  ]);
  expect(prompt).toContain('CNAME app.example.com → quiet-otter.nibrun.app');
  expect(prompt).toContain('CNAME _acme-challenge.app.example.com → delegation.example.net');
  expect(prompt).toContain("Ask me who my domain's DNS provider is");
  expect(prompt).toContain('guide me through');
});
