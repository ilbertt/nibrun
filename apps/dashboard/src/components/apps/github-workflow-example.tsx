import type { GitHubWorkflow } from '@repo/app-operations';
import { Skeleton } from '@repo/ui/components/skeleton';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { githubWorkflowExample } from '#lib/github-workflow-example.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDeployedArtifact } from '#lib/hooks/use-deployed-artifact.ts';

export function GitHubWorkflowExample({ workflow }: { workflow: GitHubWorkflow }) {
  const appId = useAppId();
  const deployed = useDeployedArtifact(appId);

  if (deployed.status === 'loading') {
    return <Skeleton className="h-48 w-full" />;
  }
  if (deployed.status === 'unknown') {
    return (
      <p className="text-muted-foreground text-sm">
        Binary filename unavailable. A workflow example can be generated when this app’s deployed
        binary can be read.
      </p>
    );
  }

  if ('kind' in deployed.artifact) {
    return (
      <p className="text-muted-foreground text-sm">
        Deploy this image through the CLI or dashboard. GitHub OIDC deployment currently supports
        compiled binaries.
      </p>
    );
  }

  const example = githubWorkflowExample({
    appId,
    workflow,
    binaryName: deployed.artifact.originalFileName,
  });

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm">
          Save as <code>.github/workflows/{workflow.workflow}</code> in{' '}
          <code>{workflow.repository}</code>.
        </p>
        <CopyButton value={example} />
      </div>
      <pre className="code-surface overflow-x-auto p-4 text-xs">
        <code>{example}</code>
      </pre>
      <p className="text-muted-foreground text-sm">
        Replace ./build.sh with your build command and write the Linux x64 binary to{' '}
        <code>./{deployed.artifact.originalFileName}</code>. Requires a CLI release with GitHub OIDC
        deployment support.
      </p>
    </div>
  );
}
