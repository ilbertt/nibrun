import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { usePlatformSuffix } from '#lib/hooks/use-platform-suffix.ts';
import type { AppSummary } from '#queries/apps.ts';

type Hostname = AppSummary['hostnames'][number];

/**
 * The records a pending domain is waiting on, under the headings a DNS provider asks for them by.
 *
 * Copyable and selectable both: a record is pasted into somebody else's form, usually more than
 * once, and often not by the person reading this page.
 */
export function DomainRecords({ hostname }: { hostname: Hostname }) {
  const app = useApp(useAppId());
  const suffix = usePlatformSuffix();

  return (
    // Bordered rather than filled, because a row of this table lights up on hover and has to
    // have something to light up against.
    <div className="overflow-hidden rounded-xl border">
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-8">Type</TableHead>
            <TableHead className="h-8">Name</TableHead>
            <TableHead className="h-8">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <DomainRecord name={hostname.hostname} value={`${app.data?.slug}.${suffix}`} />
          {hostname.dcvTarget ? (
            <DomainRecord
              name={`_acme-challenge.${hostname.hostname}`}
              value={hostname.dcvTarget}
            />
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

function DomainRecord({ name, value }: { name: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-muted-foreground">CNAME</TableCell>
      <CopyableCell value={name} />
      <CopyableCell value={value} />
    </TableRow>
  );
}

function CopyableCell({ value }: { value: string }) {
  return (
    // Wrapping, against the table's own default: a delegation target is fifty characters, and a
    // row that scrolls sideways on a phone hides the column the reader came for.
    <TableCell className="whitespace-normal">
      <span className="flex items-center gap-1">
        <span className="wrap-anywhere select-all font-mono">{value}</span>
        <CopyButton value={value} />
      </span>
    </TableCell>
  );
}
