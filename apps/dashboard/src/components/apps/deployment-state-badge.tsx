import type { DeploymentState } from '@repo/protocol';
import { Badge } from '@repo/ui/components/badge';
import type { ComponentProps } from 'react';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const VARIANT: Record<DeploymentState, BadgeVariant> = {
  pending: 'outline',
  starting: 'outline',
  running: 'default',
  stopped: 'secondary',
  superseded: 'secondary',
  failed: 'destructive',
};

export function DeploymentStateBadge({ state }: { state: DeploymentState }) {
  return <Badge variant={VARIANT[state]}>{state}</Badge>;
}
