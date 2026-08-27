import { Skeleton } from '@repo/ui/components/skeleton';
import { CopyButton } from '@repo/ui/custom/copy-button';
import { useDeployedBinary } from '#lib/hooks/use-deployed-binary.ts';
import { runCommand } from '#lib/run-command.ts';
import type { AppSummary } from '#queries/apps.ts';

/**
 * How the app starts, as one line to copy. Without a binary to name there is no command to give,
 * so the arguments stand on their own — which is all an app that has never been deployed has.
 */
export function AppRunCommand({ app }: { app: AppSummary }) {
  const binary = useDeployedBinary(app.id);

  if (binary.status === 'unknown') {
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
      {binary.status === 'loading' ? (
        <Skeleton className="h-8 w-full rounded-lg" />
      ) : (
        <RunCommandLine command={runCommand({ binaryName: binary.name, args: app.config.args })} />
      )}
    </div>
  );
}

function RunCommandLine({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 select-all break-words font-mono text-xs">{command}</code>
      <CopyButton value={command} />
    </div>
  );
}

function AppArguments({ args }: { args: readonly string[] }) {
  if (args.length === 0) {
    return <span className="text-muted-foreground">None — the binary runs bare.</span>;
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
