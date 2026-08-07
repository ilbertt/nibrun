import { Link } from '@tanstack/react-router';
import { AppStateBadge } from '#components/apps/app-state-badge.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import type { AppSummary } from '#queries/apps.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';

export function AppsTable({ apps }: { apps: readonly AppSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Slug</TableHead>
          <TableHead>State</TableHead>
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
              <AppStateBadge state={app.state} />
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
