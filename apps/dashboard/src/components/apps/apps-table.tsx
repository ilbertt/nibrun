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
            <TableCell className="font-medium">{app.slug}</TableCell>
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
