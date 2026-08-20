import type { AppHostnameState } from '@repo/protocol';
import { Badge } from '@repo/ui/components/badge';
import type { ComponentProps } from 'react';

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

const VARIANT: Record<AppHostnameState, BadgeVariant> = {
  pending: 'secondary',
  active: 'default',
  failed: 'destructive',
};

export function HostnameStateBadge({ state }: { state: AppHostnameState }) {
  return <Badge variant={VARIANT[state]}>{state}</Badge>;
}
