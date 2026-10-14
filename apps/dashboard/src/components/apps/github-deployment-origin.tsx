import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { GithubMark } from '@repo/ui/custom/github-mark';
import type { DeploymentSummary } from '#queries/deployments.ts';

const LABEL = 'Deployed by GitHub Actions';

export function GitHubDeploymentOrigin({
  github,
}: {
  github: NonNullable<DeploymentSummary['github']>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={`https://github.com/${github.repository}/actions/runs/${github.runId}/attempts/${github.runAttempt}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={LABEL}
          >
            <GithubMark className="size-3" />
          </a>
        }
        className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
      />
      <TooltipContent>{LABEL}</TooltipContent>
    </Tooltip>
  );
}
