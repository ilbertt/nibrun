import type { GitHubWorkflow } from '@repo/app-operations';
import { Skeleton } from '@repo/ui/components/skeleton';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { githubWorkflowExample } from '#lib/github-workflow-example.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useDeployedBinary } from '#lib/hooks/use-deployed-binary.ts';

export function GitHubWorkflowExample({ workflow }: { workflow: GitHubWorkflow }) {
  const appId = useAppId();
  const binary = useDeployedBinary(appId);

  if (binary.status === 'loading') {
    return <Skeleton className="h-48 w-full" />;
  }
  if (binary.status === 'unknown') {
    return (
      <p className="text-muted-foreground text-sm">
        Binary filename unavailable. A workflow example can be generated when this app’s deployed
        binary can be read.
      </p>
    );
  }

  const example = githubWorkflowExample({ appId, workflow, binaryName: binary.name });

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
        <code>./{binary.name}</code>. Requires a CLI release with GitHub OIDC deployment support.
      </p>
    </div>
  );
}
