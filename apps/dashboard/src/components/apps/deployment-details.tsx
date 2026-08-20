import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/popover';
import { DeploymentStateBadge } from '#components/apps/deployment-state-badge.tsx';
import { dayAndSecond } from '#lib/format-timestamp.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';

const ABSENT = '—';

function instant(value: string | undefined): string {
  return value === undefined ? ABSENT : dayAndSecond(value);
}

/**
 * The state badge is the trigger because the state is the thing being explained: every row has
 * one, and what a reader wants from it — when it started, when it began serving, why it stopped —
 * is the same question whichever state it landed in.
 */
export function DeploymentDetails({ deployment }: { deployment: DeploymentSummary }) {
  const observed = [
    { label: 'Created', value: dayAndSecond(deployment.createdAt) },
    { label: 'Started', value: instant(deployment.startedAt) },
    { label: 'Activated', value: instant(deployment.activatedAt) },
    { label: 'Last healthy', value: instant(deployment.lastHealthyAt) },
    { label: 'Restarts', value: String(deployment.restartCount) },
  ];

  return (
    <Popover>
      <PopoverTrigger className="cursor-pointer">
        <DeploymentStateBadge state={deployment.state} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
          {observed.map((entry) => (
            <div className="contents" key={entry.label}>
              <dt className="text-muted-foreground">{entry.label}</dt>
              <dd className="whitespace-nowrap text-right tabular-nums">{entry.value}</dd>
            </div>
          ))}
        </dl>
        {deployment.message === undefined ? null : (
          <p className="border-t pt-3 text-muted-foreground text-xs">{deployment.message}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
