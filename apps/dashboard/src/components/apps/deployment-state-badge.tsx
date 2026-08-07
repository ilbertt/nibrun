import type { DeploymentState } from '@repo/protocol';
import type { ComponentProps } from 'react';
import { Badge } from '#components/ui/badge.tsx';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const VARIANT: Record<DeploymentState, BadgeVariant> = {
  pending: 'outline',
  starting: 'outline',
  active: 'default',
  superseded: 'secondary',
  failed: 'destructive',
};

export function DeploymentStateBadge({ state }: { state: DeploymentState }) {
  return <Badge variant={VARIANT[state]}>{state}</Badge>;
}
