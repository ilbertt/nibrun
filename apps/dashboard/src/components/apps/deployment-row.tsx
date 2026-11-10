import { TableCell, TableRow } from '@repo/ui/components/table';
import { BinaryLabel } from '#components/apps/binary-label.tsx';
import { DeploymentDetails } from '#components/apps/deployment-details.tsx';
import { SystemDeploymentOrigin } from '#components/apps/system-deployment-origin.tsx';
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
  const isSystem = deployment.initiatedBy !== 'owner';

  return (
    <TableRow
      className={
        isSystem
          ? 'bg-muted/40 text-muted-foreground opacity-60 grayscale hover:bg-muted/40'
          : undefined
      }
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-mono">{deployment.id}</span>
          {isSystem && <SystemDeploymentOrigin />}
        </div>
      </TableCell>
      <TableCell>
        <DeploymentDetails deployment={deployment} />
      </TableCell>
      <TableCell className="font-mono">
        {artifact === undefined ? (
          ABSENT
        ) : (
          <BinaryLabel
            artifact={artifact}
            github={deployment.github}
            mcp={deployment.mcp}
            showProvenance={!isSystem}
          />
        )}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        {deployment.activatedAt === undefined ? ABSENT : dayAndMinute(deployment.activatedAt)}
      </TableCell>
    </TableRow>
  );
}
