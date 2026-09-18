import { TableCell, TableRow } from '@repo/ui/components/table';
import { ArtifactDigest } from '#components/apps/artifact-digest.tsx';
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
      <TableCell className="font-mono">{artifact?.originalFileName ?? ABSENT}</TableCell>
      <TableCell className="font-mono text-muted-foreground">
        {artifact === undefined ? ABSENT : <ArtifactDigest digest={artifact.digest} />}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {deployment.activatedAt === undefined ? ABSENT : dayAndMinute(deployment.activatedAt)}
      </TableCell>
    </TableRow>
  );
}
