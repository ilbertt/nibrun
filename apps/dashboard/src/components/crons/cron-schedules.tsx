import type { CronListing } from '@repo/protocol';
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

export function CronSchedules({ listing }: { listing: CronListing }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">Time zone: {listing.timeZone}</p>
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
                <TableHead>Command</TableHead>
                <TableHead>Job ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.jobs.map((job) => (
                <TableRow key={job.jobId}>
                  <TableCell className="align-top font-mono">{job.schedule}</TableCell>
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
