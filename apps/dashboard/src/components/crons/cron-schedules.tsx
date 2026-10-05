import type { CronListing } from '@repo/api/domain';
import { Badge } from '@repo/ui/components/badge';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@repo/ui/components/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { TableContainer } from '@repo/ui/custom/table-container';
import { ClockIcon } from 'lucide-react';
import { useCronTimeZone } from '#lib/hooks/use-cron-time-zone.ts';

export function CronSchedules({ listing }: { listing: CronListing }) {
  const timeZone = useCronTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">Schedule time zone: {listing.timeZone}</p>
      {listing.jobs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClockIcon />
            </EmptyMedia>
            <EmptyTitle>No cron jobs registered</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Schedule</TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    Next execution (estimated)
                    <Badge
                      aria-label="Use local time for next executions"
                      aria-pressed={timeZone.isLocal}
                      className="cursor-pointer px-1.5 outline-none hover:bg-secondary/80"
                      onClick={timeZone.toggle}
                      render={<button type="button" />}
                      variant="secondary"
                    >
                      {timeZone.label}
                    </Badge>
                  </div>
                </TableHead>
                <TableHead>Command</TableHead>
                <TableHead>Job ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.jobs.map((job) => (
                <TableRow key={job.jobId}>
                  <TableCell className="align-top font-mono">{job.schedule}</TableCell>
                  <TableCell className="align-top tabular-nums">
                    {listing.enabled && job.nextRunAt !== undefined ? (
                      <time dateTime={job.nextRunAt}>
                        {timeZone.formatTimestamp(job.nextRunAt)}
                      </time>
                    ) : (
                      <span className="text-muted-foreground">
                        {listing.enabled ? 'Unavailable' : 'Disabled'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal break-all align-top font-mono">
                    {job.command}
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal break-all align-top font-mono text-muted-foreground text-xs">
                    {job.jobId}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
