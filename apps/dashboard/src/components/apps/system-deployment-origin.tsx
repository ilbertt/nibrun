import { Badge } from '@repo/ui/components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import type { DeploymentSummary } from '#queries/deployments.ts';

const REASONS = {
  'system.host-migration': 'Host migration',
  'system.storage-migration': 'Storage migration',
} satisfies Record<Exclude<DeploymentSummary['initiatedBy'], 'owner'>, string>;

export function SystemDeploymentOrigin({
  initiatedBy,
}: {
  initiatedBy: DeploymentSummary['initiatedBy'];
}) {
  if (initiatedBy === 'owner') {
    return null;
  }
  const label = `System · ${REASONS[initiatedBy]}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="secondary" />}
        className="font-sans"
        aria-label={label}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent>
        Created automatically by nibrun using the existing app binary.
      </TooltipContent>
    </Tooltip>
  );
}
