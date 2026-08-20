import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { addDomain, appBySlug, removeDomain } from '@repo/app-operations';
import type { Ui } from '#lib/ui.ts';

const COLUMN_GAP = '  ';

const HEADINGS = { hostname: 'HOSTNAME', kind: 'KIND', state: 'STATE' };

type DomainRow = { hostname: string; kind: string; state: string };

/** Print every hostname the app answers on, or is waiting to. */
export async function listDomains({
  api,
  slug,
  print,
}: {
  api: PublicApiClient;
  slug: string;
  print: Print;
}): Promise<void> {
  const app = await appBySlug({ api, slug });
  for (const line of render(app.hostnames)) {
    print.info(line);
  }

  // Under the table rather than in it: a pending domain is waiting on the reader's own DNS, and
  // a column wide enough to say which records would not be a column.
  for (const pending of app.hostnames.filter((each) => each.state === 'pending')) {
    print.dim('');
    print.dim(`${pending.hostname} is waiting on:`);
    for (const record of pendingRecords({
      hostname: pending.hostname,
      dcvTarget: pending.dcvTarget,
      app,
    })) {
      print.dim(`  ${record}`);
    }
  }
}

export async function addAppDomain({
  api,
  slug,
  hostname,
  ui,
}: {
  api: PublicApiClient;
  slug: string;
  hostname: string;
  ui: Ui;
}): Promise<void> {
  const app = await appBySlug({ api, slug });
  const added = await addDomain({ api, appId: app.id, hostname });

  for (const record of pendingRecords({
    hostname: added.hostname,
    dcvTarget: added.dcvTarget,
    app,
  })) {
    ui.step(record);
  }
  ui.done(`${added.hostname} answers once those resolve. Nothing here has to be run again.`);
}

/**
 * The two records, in the order they matter: the first is what routes the domain and what proves
 * the owner controls it, the second is what lets the edge renew the certificate afterwards
 * without ever coming back to them.
 */
function pendingRecords({
  hostname,
  dcvTarget,
  app,
}: {
  hostname: string;
  dcvTarget: string | null;
  app: { slug: string; hostnames: readonly { hostname: string; kind: string }[] };
}): string[] {
  const records = [`${hostname}  CNAME  ${app.slug}.${platformSuffix(app.hostnames)}`];
  if (dcvTarget) {
    records.push(`_acme-challenge.${hostname}  CNAME  ${dcvTarget}`);
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
  ui,
}: {
  api: PublicApiClient;
  slug: string;
  hostname: string;
  ui: Ui;
}): Promise<void> {
  const app = await appBySlug({ api, slug });
  await removeDomain({ api, appId: app.id, hostname });

  ui.done(`${hostname} no longer points at ${app.slug}.`);
}

/**
 * What a brought domain is pointed at: the app's own platform hostname, which resolves to the
 * fleet already. Read off the app rather than configured here, so the CLI holds no copy of a
 * domain the deployment owns.
 */
function platformSuffix(hostnames: readonly { hostname: string; kind: string }[]): string {
  const platform = hostnames.find((each) => each.kind === 'platform');
  return platform?.hostname.split('.').slice(1).join('.') ?? '';
}

export function render(hostnames: readonly DomainRow[]): string[] {
  const rows = [HEADINGS, ...hostnames];
  const hostnameWidth = Math.max(...rows.map((row) => row.hostname.length));
  const kindWidth = Math.max(...rows.map((row) => row.kind.length));

  return rows.map((row) =>
    [row.hostname.padEnd(hostnameWidth), row.kind.padEnd(kindWidth), row.state].join(COLUMN_GAP),
  );
}
