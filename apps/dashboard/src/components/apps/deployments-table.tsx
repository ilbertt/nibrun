import { Table, TableBody, TableHead, TableHeader, TableRow } from '@repo/ui/components/table';
import { DeploymentRow } from '#components/apps/deployment-row.tsx';
import type { ArtifactSummary } from '#queries/artifacts.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';

export function DeploymentsTable({
  deployments,
  artifacts,
}: {
  deployments: readonly DeploymentSummary[];
  artifacts: readonly ArtifactSummary[];
}) {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Deployment</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Binary</TableHead>
          <TableHead>Activated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deployments.map((deployment) => (
          <DeploymentRow
            key={deployment.id}
            deployment={deployment}
            artifact={artifactsById.get(deployment.artifactId)}
          />
        ))}
      </TableBody>
    </Table>
  );
}
