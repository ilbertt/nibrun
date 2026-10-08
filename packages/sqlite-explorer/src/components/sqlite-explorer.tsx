import { cn } from '@repo/ui/lib/utils';
import { ConnectionForm } from '#components/connection-form.tsx';
import { ExplorerHeader } from '#components/explorer-header.tsx';
import { StudioWorkspace } from '#components/studio-workspace.tsx';
import { useSqliteExplorer } from '#hooks/use-sqlite-explorer.ts';

export function SqliteExplorer({ className }: { className: string | undefined }) {
  const explorer = useSqliteExplorer();
  if (!explorer.workspace) {
    return (
      <div className={className}>
        <ConnectionForm
          connecting={explorer.connecting}
          error={explorer.error}
          connect={explorer.connect}
        />
      </div>
    );
  }
  return (
    <section
      className={cn(
        'sqlite-explorer flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/20 bg-background',
        className,
      )}
    >
      <ExplorerHeader url={explorer.workspace.url} disconnect={explorer.disconnect} />
      <StudioWorkspace workspace={explorer.workspace} />
    </section>
  );
}
