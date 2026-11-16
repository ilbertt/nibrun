import { artifactProgram } from '@repo/app-ui';
import { Skeleton } from '@repo/ui/components/skeleton';
import { CopyableLine } from '@repo/ui/custom/copyable-line';
import { useDeployedArtifact } from '#lib/hooks/use-deployed-artifact.ts';
import { runCommand } from '#lib/run-command.ts';
import type { AppSummary } from '#queries/apps.ts';

/**
 * How the app starts, as one line to copy. Without a deployed artifact there is no program to name,
 * so the arguments stand on their own — which is all an app that has never been deployed has.
 */
export function AppRunCommand({ app }: { app: AppSummary }) {
  const deployed = useDeployedArtifact(app.id);

  if (deployed.status === 'unknown') {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground">Arguments</span>
        <AppArguments args={app.config.args} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground">Run command</span>
      {deployed.status === 'loading' ? (
        <Skeleton className="h-8 w-full rounded-lg" />
      ) : (
        <CopyableLine
          value={runCommand({
            binaryName: artifactProgram(deployed.artifact),
            args: app.config.args,
          })}
          prompt={false}
        />
      )}
      {deployed.status === 'ready' && 'kind' in deployed.artifact && (
        <span className="text-muted-foreground text-sm">
          Working directory: <code>{deployed.artifact.workingDirectory}</code>
        </span>
      )}
    </div>
  );
}

function AppArguments({ args }: { args: readonly string[] }) {
  if (args.length === 0) {
    return <span className="text-muted-foreground">The app starts without arguments.</span>;
  }

  return (
    <ol className="flex flex-wrap gap-1">
      {[...args.entries()].map(([position, arg]) => (
        <li key={position} className="rounded-md bg-muted px-2 py-0.5 font-mono">
          {arg}
        </li>
      ))}
    </ol>
  );
}
