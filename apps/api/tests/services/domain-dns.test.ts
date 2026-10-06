import { expect, test } from 'bun:test';
import { AppIdSchema, HostnameSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import { certificateValidationName, requiredDomainDnsRecords } from '#lib/dns-records.ts';
import { NotFoundError } from '#lib/errors.ts';
import type { AppHostnameRow } from '#repositories/app-hostnames.repository.ts';
import type { DnsRepositoryContract } from '#repositories/dns.repository.ts';
import { DomainDnsService } from '#services/domain-dns.service.ts';

const OWNED_APP = {
  appId: Value.Parse(AppIdSchema, 'app-1'),
  ownerId: Value.Parse(OwnerIdSchema, 'owner-1'),
};
const HOSTNAME = Value.Parse(HostnameSchema, 'app.example.dev');
const PLATFORM = Value.Parse(HostnameSchema, 'quiet-otter.nibrun.app');
const DCV_TARGET = 'delegation.example.com';
const VALIDATION_NAME = certificateValidationName(HOSTNAME);
const REQUIRED_RECORDS = requiredDomainDnsRecords({
  hostname: HOSTNAME,
  routingTarget: PLATFORM,
  dcvTarget: DCV_TARGET,
});

function row(overrides: Partial<AppHostnameRow> = {}): AppHostnameRow {
  return {
    hostname: HOSTNAME,
    kind: 'custom',
    state: 'pending',
    dcv_target: DCV_TARGET,
    edge_errors: [],
    created_at: new Date(),
    ...overrides,
  };
}

function fixture({
  rows = [row(), row({ hostname: PLATFORM, kind: 'platform', dcv_target: null })],
  answers = {},
}: {
  rows?: AppHostnameRow[];
  answers?: Record<string, string[] | Error>;
} = {}) {
  const lookups: string[] = [];
  const scopes: (typeof OWNED_APP)[] = [];
  const dnsRepo: DnsRepositoryContract = {
    cnameTargets({ hostname }) {
      lookups.push(hostname);
      const answer = answers[hostname] ?? [];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const service = new DomainDnsService({
    dnsRepo,
    hostnamesRepo: {
      listByApp(scope) {
        scopes.push(scope);
        return Promise.resolve(rows);
      },
    },
  });
  return { service, lookups, scopes };
}

test('checks routing and certificate delegation independently against the expected targets', async () => {
  const { service, scopes } = fixture({
    answers: {
      [HOSTNAME]: ['QUIET-OTTER.NIBRUN.APP.'],
      [VALIDATION_NAME]: ['wrong.example.com'],
    },
  });
  const { records } = await service.check({ ...OWNED_APP, hostname: HOSTNAME });
  expect(scopes).toEqual([OWNED_APP]);
  expect(records).toEqual([
    {
      ...REQUIRED_RECORDS[0]!,
      matched: true,
      observedTargets: ['QUIET-OTTER.NIBRUN.APP.'],
    },
    {
      ...REQUIRED_RECORDS[1]!,
      matched: false,
      observedTargets: ['wrong.example.com'],
    },
  ]);
});

test('a resolver failure preserves the required record and does not hide the other result', async () => {
  const { service } = fixture({
    answers: {
      [HOSTNAME]: new Error('SERVFAIL'),
      [VALIDATION_NAME]: [DCV_TARGET],
    },
  });
  const { records } = await service.check({ ...OWNED_APP, hostname: HOSTNAME });
  expect(records[0]).toEqual({
    ...REQUIRED_RECORDS[0]!,
    matched: null,
    observedTargets: [],
  });
  expect(records[1]?.matched).toBe(true);
});

test('apex domains only check routing and leave invisible flattened CNAMEs unconfirmed', async () => {
  const apex = Value.Parse(HostnameSchema, 'example.dev');
  const { service, lookups } = fixture({
    rows: [
      row({ hostname: apex, dcv_target: null }),
      row({ hostname: PLATFORM, kind: 'platform' }),
    ],
  });
  const { records } = await service.check({ ...OWNED_APP, hostname: apex });
  expect(records).toHaveLength(1);
  expect(records[0]?.matched).toBe(false);
  expect(lookups).toEqual([apex]);
});

test.each([{ rows: [] }, { rows: [row({ hostname: PLATFORM, kind: 'platform' })] }])(
  'unowned or unregistered names never reach DNS',
  async ({ rows }) => {
    const { service, lookups } = fixture({ rows: [...rows] });
    await expect(service.check({ ...OWNED_APP, hostname: HOSTNAME })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(lookups).toEqual([]);
  },
);
