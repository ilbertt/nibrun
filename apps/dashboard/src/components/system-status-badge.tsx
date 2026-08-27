import { Badge } from '@repo/ui/components/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/popover';
import { cn } from '@repo/ui/lib/utils';
import { type ApiHealth, useApiHealth } from '#lib/hooks/use-api-health.ts';
import type { ComponentName, SystemComponents } from '#queries/health.ts';

const BADGE: Record<ApiHealth['state'], { label: string; dotClassName: string }> = {
  checking: { label: 'Checking', dotClassName: 'bg-muted-foreground animate-pulse' },
  healthy: { label: 'System healthy', dotClassName: 'bg-emerald-500' },
  degraded: { label: 'System degraded', dotClassName: 'bg-amber-500' },
  unreachable: { label: 'System unreachable', dotClassName: 'bg-destructive' },
};

const DOT: Record<SystemComponents[ComponentName]['status'], string> = {
  up: 'bg-emerald-500',
  down: 'bg-destructive',
  unknown: 'bg-amber-500',
};

/** Also the order they are read in: the fleet first, then what this process itself talks to. */
const LABEL: Record<ComponentName, string> = {
  appHost: 'App host',
  agent: 'Host agent',
  database: 'Database',
  logStore: 'Log store',
  objectStore: 'Object store',
};

const NAMES = Object.keys(LABEL) as ComponentName[];

const WITHOUT_COMPONENTS: Record<'checking' | 'unreachable', string> = {
  checking: 'Asking the api how it is.',
  unreachable: 'The api did not answer, so nothing below it can be reported on either.',
};

/**
 * The badge is the trigger because the badge is the summary: one word for a system of five parts,
 * and the only question it leaves is which part it was said for.
 */
export function SystemStatusBadge() {
  const health = useApiHealth();
  const { label, dotClassName } = BADGE[health.state];

  return (
    <Popover>
      <PopoverTrigger openOnHover className="cursor-default">
        <Badge variant="outline" className="gap-1.5">
          <span className={cn('size-1.5 rounded-full', dotClassName)} />
          {label}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {health.components === undefined ? (
          <p className="text-muted-foreground text-xs">{WITHOUT_COMPONENTS[health.state]}</p>
        ) : (
          <ComponentBreakdown components={health.components} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ComponentBreakdown({ components }: { components: SystemComponents }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-xs">
      {NAMES.map((name) => (
        <div className="contents" key={name}>
          <dt>
            {LABEL[name]}
            {components[name].detail === undefined ? null : (
              <p className="text-muted-foreground">{components[name].detail}</p>
            )}
          </dt>
          <dd className="flex items-center gap-1.5 self-start">
            <span
              className={cn('size-1.5 rounded-full', DOT[components[name].status])}
              aria-hidden="true"
            />
            {components[name].status}
          </dd>
        </div>
      ))}
    </dl>
  );
}
