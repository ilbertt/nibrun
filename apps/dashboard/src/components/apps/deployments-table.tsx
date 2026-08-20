import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/table';
import { DeploymentDetails } from '#components/apps/deployment-details.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';

export function DeploymentsTable({ deployments }: { deployments: readonly DeploymentSummary[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Deployment</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Activated</TableHead>
          <TableHead>Replays</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deployments.map((deployment) => (
          <TableRow key={deployment.id}>
            <TableCell className="font-mono">{deployment.id}</TableCell>
            <TableCell>
              <DeploymentDetails deployment={deployment} />
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {dayAndMinute(deployment.createdAt)}
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {deployment.activatedAt === undefined ? '—' : dayAndMinute(deployment.activatedAt)}
            </TableCell>
            <TableCell className="font-mono text-muted-foreground">
              {deployment.rollbackOf ?? '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
