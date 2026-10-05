import { expect, test } from 'bun:test';
import { requiredDomainDnsRecords } from '@repo/api/lib/dns-records';
import type { DomainDnsRecord } from '@repo/app-operations';
import { renderToStaticMarkup } from 'react-dom/server';
import { DomainDnsStatus } from '#components/apps/domain-dns-status.tsx';

const REQUIRED_RECORD = requiredDomainDnsRecords({
  hostname: 'app.example.com',
  routingTarget: 'app.nibrun.app',
  dcvTarget: undefined,
})[0]!;

function record(matched: DomainDnsRecord['matched']): DomainDnsRecord {
  return {
    ...REQUIRED_RECORD,
    matched,
    observedTargets: matched ? [REQUIRED_RECORD.target] : [],
  };
}

test.each([true, false, null])(
  'a refresh shows checking instead of the previous result %s',
  (matched) => {
    const markup = renderToStaticMarkup(
      <DomainDnsStatus record={record(matched)} isChecking={true} />,
    );
    expect(markup).toContain('Checking…');
    expect(markup).not.toContain('Confirmed');
    expect(markup).not.toContain('Not visible yet');
    expect(markup).not.toContain('Check unavailable');
  },
);

test('a completed refresh displays its latest result, including a newly missing record', () => {
  expect(
    renderToStaticMarkup(<DomainDnsStatus record={record(true)} isChecking={false} />),
  ).toContain('Confirmed');
  expect(
    renderToStaticMarkup(<DomainDnsStatus record={record(false)} isChecking={false} />),
  ).toContain('Not visible yet');
});
