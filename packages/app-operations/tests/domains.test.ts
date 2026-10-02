import { expect, test } from 'bun:test';
import { requiredDomainDnsRecords } from '@repo/protocol';
import { domainDnsPrompt } from '#domains.ts';

test('the agent prompt carries routing and certificate records and asks for the DNS provider', () => {
  const records = requiredDomainDnsRecords({
    hostname: 'app.example.com',
    routingTarget: 'quiet-otter.nibrun.app',
    dcvTarget: 'delegation.example.net',
  });
  const prompt = domainDnsPrompt(records);
  for (const record of records) {
    expect(prompt).toContain(`${record.type} ${record.hostname} → ${record.target}`);
  }
  expect(prompt).toContain("Ask me who my domain's DNS provider is");
  expect(prompt).toContain('guide me through');
});
