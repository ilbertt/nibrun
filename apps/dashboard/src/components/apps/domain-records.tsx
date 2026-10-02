import { type DomainDnsRecord, domainDnsPrompt } from '@repo/app-operations';
import { Button } from '@repo/ui/components/button';
import { Spinner } from '@repo/ui/components/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { AgentPromptButton } from '@repo/ui/custom/agent-prompt-button';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { RefreshCwIcon } from 'lucide-react';
import { DomainDnsStatus } from '#components/apps/domain-dns-status.tsx';
import { RetryValidationButton } from '#components/apps/retry-validation-button.tsx';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDomainDns } from '#lib/hooks/use-domain-dns.ts';
import { useElapsed } from '#lib/hooks/use-elapsed.ts';
import type { AppSummary } from '#queries/apps.ts';

type Hostname = AppSummary['hostnames'][number];

/**
 * The required records, under the headings a DNS provider asks for them by.
 *
 * Copyable and selectable both: a record is pasted into somebody else's form, usually more than
 * once, and often not by the person reading this page.
 */
export function DomainRecords({ hostname }: { hostname: Hostname }) {
  const dns = useDomainDns({
    appId: useAppId(),
    hostname: hostname.hostname,
    pending: hostname.state === 'pending',
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {dns.data ? (
          <AgentPromptButton
            label="Ask your agent"
            prompt={domainDnsPrompt(dns.data.records)}
            compact={true}
          />
        ) : null}
        {hostname.state === 'pending' ? <RetryValidation hostname={hostname} /> : null}
      </div>
      {/* Bordered rather than filled, because a row of this table lights up on hover and has to
          have something to light up against. */}
      <div className="overflow-hidden rounded-xl border">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8">Type</TableHead>
              <TableHead className="h-8">Name</TableHead>
              <TableHead className="h-8">Value</TableHead>
              <TableHead className="h-8">
                <span className="inline-flex items-center gap-1">
                  Status
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Check DNS"
                    title="Check DNS"
                    disabled={dns.isFetching}
                    onClick={() => void dns.refetch()}
                  >
                    {dns.isFetching ? <Spinner /> : <RefreshCwIcon />}
                  </Button>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dns.data?.records.map((record) => (
              <DomainRecord key={record.hostname} record={record} isChecking={dns.isFetching} />
            ))}
            {dns.isPending ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    Checking DNS records…
                  </span>
                </TableCell>
              </TableRow>
            ) : null}
            {dns.isError ? (
              <TableRow>
                <TableCell colSpan={4}>Could not check DNS records. Try again.</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <EdgeReport errors={hostname.edgeErrors} />
    </div>
  );
}

/**
 * How long the edge gets before the owner is offered to hurry it: it looks on its own within
 * moments of being told, so a retry sooner than this is a second request for the first check.
 */
const EDGES_OWN_TURN_MS = 60_000;

function RetryValidation({ hostname }: { hostname: Hostname }) {
  const edgeHasHadItsTurn = useElapsed({ since: hostname.createdAt, ms: EDGES_OWN_TURN_MS });
  if (!edgeHasHadItsTurn) {
    return null;
  }
  return <RetryValidationButton hostname={hostname.hostname} />;
}

/**
 * The edge's own words on what is still missing. Nothing while there are none, because a domain added a
 * moment ago has not been asked about yet and one the edge is busy with has no error to show.
 */
function EdgeReport({ errors }: { errors: string[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
      {errors.map((error) => (
        <li key={error} className="wrap-anywhere">
          The edge reports: {error}
        </li>
      ))}
    </ul>
  );
}

function DomainRecord({ record, isChecking }: { record: DomainDnsRecord; isChecking: boolean }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-muted-foreground">{record.type}</TableCell>
      <CopyableCell value={record.hostname} />
      <CopyableCell value={record.target} />
      <TableCell>
        <DomainDnsStatus record={record} isChecking={isChecking} />
      </TableCell>
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
