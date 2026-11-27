import { artifactName } from '@repo/app-ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { useClipboardCopy } from '@repo/ui/hooks/use-clipboard-copy';
import { ContainerIcon } from 'lucide-react';
import { BinaryOrigin } from '#components/apps/binary-origin.tsx';
import { GitHubDeploymentOrigin } from '#components/apps/github-deployment-origin.tsx';
import { McpDeploymentOrigin } from '#components/apps/mcp-deployment-origin.tsx';
import type { ArtifactSummary } from '#queries/artifacts.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';

// Docker's abbreviation of a SHA-256: enough to tell two binaries apart at a glance, short enough
// to sit beside the name. The whole digest is a hover away, and a click is what hands it over.
const SHORT_DIGEST_LENGTH = 12;

export function ArtifactLabel({
  artifact,
  github,
  mcp,
  showProvenance,
}: {
  artifact: ArtifactSummary;
  github: DeploymentSummary['github'];
  mcp: DeploymentSummary['mcp'];
  showProvenance: boolean;
}) {
  const { copied, copy } = useClipboardCopy({ value: artifact.digest, onCopied: undefined });

  return (
    <>
      {artifactName(artifact)}{' '}
      <span className="text-muted-foreground">
        (
        <Tooltip>
          <TooltipTrigger closeOnClick={false} onClick={copy} className="cursor-pointer">
            sha256:{artifact.digest.slice(0, SHORT_DIGEST_LENGTH)}
          </TooltipTrigger>
          <TooltipContent className="break-all font-mono">
            {copied ? 'Copied' : artifact.digest}
          </TooltipContent>
        </Tooltip>
        )
      </span>
      {showProvenance && (
        <>
          {'kind' in artifact && (
            <ContainerIcon
              className="ml-2 inline size-3 text-muted-foreground"
              aria-label="Container image"
            />
          )}
          {!('kind' in artifact) && <BinaryOrigin originalFileUrl={artifact.originalFileUrl} />}
          {mcp !== undefined && <McpDeploymentOrigin mcp={mcp} />}
          {github !== undefined && <GitHubDeploymentOrigin github={github} />}
        </>
      )}
    </>
  );
}
