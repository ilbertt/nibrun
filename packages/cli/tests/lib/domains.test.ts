import { expect, test } from 'bun:test';
import {
  APP_DOMAINS_OUTPUT,
  addAppDomain,
  DOMAIN_ADDED_OUTPUT,
  listDomains,
} from '#lib/domains.ts';
import {
  answering,
  apiHolding,
  deploymentsHolding,
  listedApp,
  RUNNING_DEPLOYMENT,
} from '#tests/support/api.ts';
import { APP_ID, HOSTNAME } from '#tests/support/app.ts';
import { writerRecording } from '#tests/support/output.ts';

const CUSTOM = 'app.example.dev';
const RECORDS = [
  {
    hostname: CUSTOM,
    type: 'CNAME' as const,
    target: HOSTNAME,
    matched: true,
    observedTargets: [HOSTNAME],
  },
  {
    hostname: `_acme-challenge.${CUSTOM}`,
    type: 'CNAME' as const,
    target: 'delegation.example.com',
    matched: null,
    observedTargets: [],
  },
];

function fixture(state: 'pending' | 'active') {
  const checked: string[] = [];
  const hostnames = [
    { hostname: HOSTNAME, kind: 'platform', state: 'active', edgeErrors: [] },
    { hostname: CUSTOM, kind: 'custom', state, edgeErrors: [] },
  ];
  const api = apiHolding({
    apps: [listedApp({ hostnames })],
    underApp: () => ({
      deployments: deploymentsHolding([RUNNING_DEPLOYMENT]),
      hostnames: {
        post: () => Promise.resolve({ data: hostnames[1], error: null, status: 201 }),
        dns: {
          get: ({ query }: { query: { hostname: string } }) => {
            checked.push(query.hostname);
            return answering({ records: RECORDS })();
          },
        },
      },
    }),
  });
  return { api, checked };
}

test.each(['pending', 'active'] as const)(
  'domain listings include DNS results for %s custom domains and never query platform DNS',
  async (state) => {
    const { api, checked } = fixture(state);
    const value = APP_DOMAINS_OUTPUT.schema.parse(await listDomains({ api, appId: APP_ID }));
    expect(checked).toEqual([CUSTOM]);
    expect(value.hostnames[0]?.records).toEqual([]);
    expect(value.hostnames[1]?.records).toEqual(RECORDS);
    const out = writerRecording();
    APP_DOMAINS_OUTPUT.render({ value, out });
    expect(out.said.join('\n')).toContain('✓ DNS confirmed');
    expect(out.said.join('\n')).toContain('DNS check unavailable');
  },
);

test('adding a pending domain includes the same DNS feedback in structured and human output', async () => {
  const { api, checked } = fixture('pending');
  const value = DOMAIN_ADDED_OUTPUT.schema.parse(
    await addAppDomain({ api, appId: APP_ID, hostname: CUSTOM }),
  );
  expect(checked).toEqual([CUSTOM]);
  expect(value.records).toEqual(RECORDS);
  const out = writerRecording();
  DOMAIN_ADDED_OUTPUT.render({ value, out });
  expect(out.said.join('\n')).toContain('DNS check unavailable');
});

test('a different target and an invisible CNAME have distinct feedback', () => {
  const out = writerRecording();
  DOMAIN_ADDED_OUTPUT.render({
    value: {
      name: 'My app',
      hostname: CUSTOM,
      state: 'pending',
      created: true,
      records: [
        { ...RECORDS[0]!, matched: false, observedTargets: ['wrong.example.com'] },
        { ...RECORDS[1]!, matched: false },
      ],
    },
    out,
  });
  expect(out.said.join('\n')).toContain('Different target: wrong.example.com');
  expect(out.said.join('\n')).toContain('CNAME not visible yet');
});
