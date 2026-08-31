import type { PublicApiClient } from '@repo/api-client/public';
import { addDomain, appBySlug, appFor, removeDomain } from '@repo/app-operations';
import { APP_HOSTNAME_KINDS, APP_HOSTNAME_STATES } from '@repo/protocol';
import { z } from 'zod';
import { defineOutput } from '#lib/output.ts';

const COLUMN_GAP = '  ';

const HEADINGS = { hostname: 'HOSTNAME', kind: 'KIND', state: 'STATE' };

/**
 * One record the owner's DNS is still missing. Structured rather than the line it is printed as,
 * because the whole use of reading this with a program is to place it.
 */
const DnsRecordSchema = z.object({
  hostname: z.string(),
  type: z.literal('CNAME'),
  target: z.string(),
});

type DnsRecord = z.infer<typeof DnsRecordSchema>;

const AppHostnameSchema = z.object({
  hostname: z.string(),
  kind: z.enum(APP_HOSTNAME_KINDS),
  state: z.enum(APP_HOSTNAME_STATES),
  /** What the domain is waiting on. Empty for one that is already answering. */
  records: z.array(DnsRecordSchema),
});

const DomainListSchema = z.object({ hostnames: z.array(AppHostnameSchema) });

const DomainAddedSchema = z.object({
  slug: z.string(),
  hostname: z.string(),
  records: z.array(DnsRecordSchema),
});

const DomainRemovedSchema = z.object({ slug: z.string(), hostname: z.string() });

type AppHostname = z.infer<typeof AppHostnameSchema>;

/** One record as a line, in the three columns a DNS panel asks for them in. */
function spell(record: DnsRecord): string {
  return `${record.hostname}  ${record.type}  ${record.target}`;
}

export const APP_DOMAINS_OUTPUT = defineOutput({
  schema: DomainListSchema,
  render: ({ value, out }) => {
    for (const line of render(value.hostnames)) {
      out.info(line);
    }

    // Under the table rather than in it: a pending domain is waiting on the reader's own DNS, and
    // a column wide enough to say which records would not be a column.
    for (const waiting of value.hostnames.filter((each) => each.records.length > 0)) {
      out.dim('');
      out.dim(`${waiting.hostname} is waiting on:`);
      for (const record of waiting.records) {
        out.dim(`  ${spell(record)}`);
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
    out.done(`${value.hostname} answers once those resolve. Nothing here has to be run again.`);
  },
});

export const DOMAIN_REMOVED_OUTPUT = defineOutput({
  schema: DomainRemovedSchema,
  render: ({ value, out }) => out.done(`${value.hostname} no longer points at ${value.slug}.`),
});

/** Every hostname the app answers on, or is waiting to. */
export async function listDomains({
  api,
  slug,
}: {
  api: PublicApiClient;
  slug: string;
}): Promise<z.input<typeof DomainListSchema>> {
  const app = await appBySlug({ api, slug });
  const target = platformTarget({ slug: app.slug, hostnames: app.hostnames });

  return {
    hostnames: app.hostnames.map((each) => ({
      hostname: each.hostname,
      kind: each.kind,
      state: each.state,
      records:
        each.state === 'pending'
          ? pendingRecords({ hostname: each.hostname, dcvTarget: each.dcvTarget, target })
          : [],
    })),
  };
}

export async function addAppDomain({
  api,
  slug,
  hostname,
}: {
  api: PublicApiClient;
  slug: string;
  hostname: string;
}): Promise<z.input<typeof DomainAddedSchema>> {
  const { app } = await appFor({ api, slug, operation: 'domains' });
  const added = await addDomain({ api, appId: app.id, hostname });

  return {
    slug: app.slug,
    hostname: added.hostname,
    records: pendingRecords({
      hostname: added.hostname,
      dcvTarget: added.dcvTarget,
      target: platformTarget({ slug: app.slug, hostnames: app.hostnames }),
    }),
  };
}

/**
 * The two records, in the order they matter: the first is what routes the domain and what proves
 * the owner controls it, the second is what lets the edge renew the certificate afterwards
 * without ever coming back to them.
 */
function pendingRecords({
  hostname,
  dcvTarget,
  target,
}: {
  hostname: string;
  dcvTarget: string | null;
  target: string;
}): DnsRecord[] {
  const records: DnsRecord[] = [{ hostname, type: 'CNAME', target }];
  if (dcvTarget) {
    records.push({ hostname: `_acme-challenge.${hostname}`, type: 'CNAME', target: dcvTarget });
  }
  return records;
}

/**
 * The domain goes without being confirmed. Unlike deleting an app there is nothing underneath it
 * to lose — the app keeps running on every other hostname — and re-adding it costs the same two
 * records it cost the first time.
 */
export async function removeAppDomain({
  api,
  slug,
  hostname,
}: {
  api: PublicApiClient;
  slug: string;
  hostname: string;
}): Promise<z.input<typeof DomainRemovedSchema>> {
  const { app } = await appFor({ api, slug, operation: 'domains' });
  await removeDomain({ api, appId: app.id, hostname });

  return { slug: app.slug, hostname };
}

/**
 * What a brought domain is pointed at: the app's own platform hostname, which resolves to the
 * fleet already. Read off the app rather than configured here, so the CLI holds no copy of a
 * domain the deployment owns.
 */
function platformTarget({
  slug,
  hostnames,
}: {
  slug: string;
  hostnames: readonly { hostname: string; kind: string }[];
}): string {
  const platform = hostnames.find((each) => each.kind === 'platform');
  return `${slug}.${platform?.hostname.split('.').slice(1).join('.') ?? ''}`;
}

export function render(hostnames: readonly Pick<AppHostname, 'hostname' | 'kind' | 'state'>[]) {
  const rows = [HEADINGS, ...hostnames];
  const hostnameWidth = Math.max(...rows.map((row) => row.hostname.length));
  const kindWidth = Math.max(...rows.map((row) => row.kind.length));

  return rows.map((row) =>
    [row.hostname.padEnd(hostnameWidth), row.kind.padEnd(kindWidth), row.state].join(COLUMN_GAP),
  );
}
