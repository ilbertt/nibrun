import type { PublicApiClient } from '@repo/api-client/public';
import { addDomain, appById, appFor, checkDomainDns, removeDomain } from '@repo/app-operations';
import { APP_HOSTNAME_KINDS, APP_HOSTNAME_STATES } from '@repo/protocol';
import { z } from 'zod';
import { defineOutput } from '#lib/output.ts';

const COLUMN_GAP = '  ';

const HEADINGS = { hostname: 'HOSTNAME', kind: 'KIND', state: 'STATE' };

/**
 * One required DNS record. Structured rather than the line it is printed as,
 * because the whole use of reading this with a program is to place it.
 */
const DnsRecordSchema = z.object({
  hostname: z.string(),
  type: z.literal('CNAME'),
  target: z.string(),
  matched: z.boolean().nullable(),
  observedTargets: z.array(z.string()),
});

type DnsRecord = z.infer<typeof DnsRecordSchema>;

const AppHostnameSchema = z.object({
  hostname: z.string(),
  kind: z.enum(APP_HOSTNAME_KINDS),
  state: z.enum(APP_HOSTNAME_STATES),
  /** Empty for the platform hostname, whose DNS nibrun manages. */
  records: z.array(DnsRecordSchema),
  /**
   * What the edge says is still missing, in its own words. Empty once nothing is, and while it
   * has not been asked — so a domain added a moment ago shows its records and no verdict yet.
   */
  edgeErrors: z.array(z.string()),
});

const DomainListSchema = z.object({ hostnames: z.array(AppHostnameSchema) });

const DomainAddedSchema = z.object({
  name: z.string(),
  hostname: z.string(),
  state: z.enum(APP_HOSTNAME_STATES),
  /** False for a domain the app already had, which adding again asks the edge to check now. */
  created: z.boolean(),
  records: z.array(DnsRecordSchema),
});

const DomainRemovedSchema = z.object({ name: z.string(), hostname: z.string() });

type AppHostname = z.infer<typeof AppHostnameSchema>;

function dnsVerdict(record: DnsRecord): string {
  if (record.matched === true) {
    return '✓ DNS confirmed';
  }
  if (record.matched === null) {
    return 'DNS check unavailable';
  }
  return record.observedTargets.length > 0
    ? `Different target: ${record.observedTargets.join(', ')}`
    : 'CNAME not visible yet (propagating, flattened, or proxied)';
}

function spell(record: DnsRecord): string {
  return `${record.hostname}  ${record.type}  ${record.target}  ${dnsVerdict(record)}`;
}

export const APP_DOMAINS_OUTPUT = defineOutput({
  schema: DomainListSchema,
  render: ({ value, out }) => {
    for (const line of render(value.hostnames)) {
      out.info(line);
    }

    // Under the table rather than in it: a column wide enough to say which records would not be
    // a column.
    for (const domain of value.hostnames.filter((each) => each.records.length > 0)) {
      out.dim('');
      out.dim(`${domain.hostname} DNS records:`);
      for (const record of domain.records) {
        out.dim(`  ${spell(record)}`);
      }
      for (const error of domain.edgeErrors) {
        out.dim(`  the edge reports: ${error}`);
      }
    }
  },
});

export const DOMAIN_ADDED_OUTPUT = defineOutput({
  schema: DomainAddedSchema,
  render: ({ value, out }) => {
    for (const record of value.records) {
      out.step(spell(record));
    }
    out.done(addedVerdict(value));
  },
});

/** Three endings for one command, because saying a domain again is the same command as saying it. */
function addedVerdict({
  hostname,
  state,
  created,
}: Pick<z.infer<typeof DomainAddedSchema>, 'hostname' | 'state' | 'created'>): string {
  if (created) {
    return `${hostname} answers once those resolve. Nothing here has to be run again.`;
  }
  if (state === 'pending') {
    return `${hostname} was already added. It will be checked again shortly; \`nib apps domains\` shows how it went.`;
  }
  return `${hostname} already answers.`;
}

export const DOMAIN_REMOVED_OUTPUT = defineOutput({
  schema: DomainRemovedSchema,
  render: ({ value, out }) => out.done(`${value.hostname} no longer points at ${value.name}.`),
});

/** Every hostname the app answers on, or is waiting to. */
export async function listDomains({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<z.input<typeof DomainListSchema>> {
  const app = await appById({ api, appId });

  return {
    hostnames: await Promise.all(
      app.hostnames.map(async (each) => ({
        hostname: each.hostname,
        kind: each.kind,
        state: each.state,
        records:
          each.kind === 'custom'
            ? (await checkDomainDns({ api, appId, hostname: each.hostname })).records
            : [],
        edgeErrors: each.edgeErrors,
      })),
    ),
  };
}

export async function addAppDomain({
  api,
  appId,
  hostname,
}: {
  api: PublicApiClient;
  appId: string;
  hostname: string;
}): Promise<z.input<typeof DomainAddedSchema>> {
  const { app } = await appFor({ api, appId, operation: 'domains' });
  const { hostname: added, created } = await addDomain({ api, appId: app.id, hostname });

  return {
    name: app.name,
    hostname: added.hostname,
    state: added.state,
    created,
    records:
      added.state === 'pending'
        ? (await checkDomainDns({ api, appId: app.id, hostname: added.hostname })).records
        : [],
  };
}

/**
 * The domain goes without being confirmed. Unlike deleting an app there is nothing underneath it
 * to lose — the app keeps running on every other hostname — and re-adding it costs the same two
 * records it cost the first time.
 */
export async function removeAppDomain({
  api,
  appId,
  hostname,
}: {
  api: PublicApiClient;
  appId: string;
  hostname: string;
}): Promise<z.input<typeof DomainRemovedSchema>> {
  const { app } = await appFor({ api, appId, operation: 'domains' });
  await removeDomain({ api, appId: app.id, hostname });

  return { name: app.name, hostname };
}

export function render(hostnames: readonly Pick<AppHostname, 'hostname' | 'kind' | 'state'>[]) {
  const rows = [HEADINGS, ...hostnames];
  const hostnameWidth = Math.max(...rows.map((row) => row.hostname.length));
  const kindWidth = Math.max(...rows.map((row) => row.kind.length));

  return rows.map((row) =>
    [row.hostname.padEnd(hostnameWidth), row.kind.padEnd(kindWidth), row.state].join(COLUMN_GAP),
  );
}
