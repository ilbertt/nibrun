import { cn } from '@repo/ui/lib/utils';
import { StudioWorkspace } from '#components/studio-workspace.tsx';
import type { SqliteWorkspace } from '#lib/workspace.ts';

export function SqliteExplorer({
  workspace,
  className,
}: {
  workspace: SqliteWorkspace;
  className: string | undefined;
}) {
  return (
    <section
      className={cn(
        'sqlite-explorer flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/20 bg-background',
        className,
      )}
    >
      <StudioWorkspace workspace={workspace} />
    </section>
  );
}
