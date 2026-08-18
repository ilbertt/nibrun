import type { AppState } from '@repo/protocol';
import { Badge } from '@repo/ui/components/badge';
import type { ComponentProps } from 'react';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const VARIANT: Record<AppState, BadgeVariant> = {
  active: 'default',
  suspended: 'secondary',
  deleting: 'outline',
  deleted: 'destructive',
};

export function AppStateBadge({ state }: { state: AppState }) {
  return <Badge variant={VARIANT[state]}>{state}</Badge>;
}
