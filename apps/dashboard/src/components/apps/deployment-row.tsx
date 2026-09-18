import { TableCell, TableRow } from '@repo/ui/components/table';
import { BinaryLabel } from '#components/apps/binary-label.tsx';
import { DeploymentDetails } from '#components/apps/deployment-details.tsx';
import { dayAndMinute } from '#lib/format-timestamp.ts';
import type { ArtifactSummary } from '#queries/artifacts.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';

const ABSENT = '—';

export function DeploymentRow({
  deployment,
  artifact,
}: {
  deployment: DeploymentSummary;
  artifact: ArtifactSummary | undefined;
}) {
  return (
    <TableRow>
      <TableCell className="font-mono">{deployment.id}</TableCell>
      <TableCell>
        <DeploymentDetails deployment={deployment} />
      </TableCell>
      <TableCell className="font-mono">
        {artifact === undefined ? ABSENT : <BinaryLabel artifact={artifact} />}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {deployment.activatedAt === undefined ? ABSENT : dayAndMinute(deployment.activatedAt)}
      </TableCell>
    </TableRow>
  );
}
