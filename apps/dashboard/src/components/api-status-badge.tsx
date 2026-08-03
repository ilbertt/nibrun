import { Badge } from '#components/ui/badge.tsx';
import { type ApiHealth, useApiHealth } from '#lib/hooks/use-api-health.ts';

const PRESENTATION: Record<ApiHealth['status'], { label: string; dotClassName: string }> = {
  checking: { label: 'Checking', dotClassName: 'bg-muted-foreground animate-pulse' },
  reachable: { label: 'Reachable', dotClassName: 'bg-emerald-500' },
  unreachable: { label: 'Unreachable', dotClassName: 'bg-destructive' },
};

export function ApiStatusBadge() {
  const { status } = useApiHealth();
  const { label, dotClassName } = PRESENTATION[status];

  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={`size-1.5 rounded-full ${dotClassName}`} />
      {label}
    </Badge>
  );
}
