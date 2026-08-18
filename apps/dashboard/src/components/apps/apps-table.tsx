import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { Link } from '@tanstack/react-router';
import { AppStatusBadge } from '#components/apps/app-status-badge.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import type { AppSummary } from '#queries/apps.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';

export function AppsTable({ apps }: { apps: readonly AppSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Slug</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last change</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {apps.map((app) => (
          <TableRow key={app.id}>
            <TableCell>
              <Link
                to={AppRoute.to}
                params={{ appId: app.id }}
                className="font-medium hover:underline"
              >
                {app.slug}
              </Link>
            </TableCell>
            <TableCell>
              <AppStatusBadge app={app} />
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {dayAndMinute(app.updatedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
