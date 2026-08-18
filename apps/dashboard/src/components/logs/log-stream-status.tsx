import type { DeploymentLogsView } from '#lib/hooks/use-deployment-logs.ts';
import { cn } from '#lib/utils.ts';

const PRESENTATION: Record<
  DeploymentLogsView['status'],
  { label: string; dotClassName: string; haloClassName: string }
> = {
  connecting: {
    label: 'Connecting',
    dotClassName: 'bg-muted-foreground motion-safe:animate-pulse',
    haloClassName: 'hidden',
  },
  following: {
    label: 'Live',
    dotClassName: 'bg-emerald-500',
    haloClassName: 'bg-emerald-500 motion-safe:animate-live-halo',
  },
  failed: {
    label: 'Stream disconnected',
    dotClassName: 'bg-destructive',
    haloClassName: 'hidden',
  },
};

export function LogStreamStatus({ status }: { status: DeploymentLogsView['status'] }) {
  const { label, dotClassName, haloClassName } = PRESENTATION[status];

  return (
    <p className="flex items-center gap-2 text-muted-foreground text-xs" role="status">
      <span className="relative inline-flex size-1.5">
        <span className={cn('absolute inset-0 rounded-full', haloClassName)} />
        <span className={cn('relative inline-flex size-1.5 rounded-full', dotClassName)} />
      </span>
      {label}
    </p>
  );
}
