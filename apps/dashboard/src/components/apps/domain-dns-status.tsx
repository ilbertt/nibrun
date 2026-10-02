import type { DomainDnsRecord } from '@repo/app-operations';
import { Spinner } from '@repo/ui/components/spinner';
import { CheckIcon, CircleHelpIcon, ClockIcon, TriangleAlertIcon } from 'lucide-react';

export function DomainDnsStatus({
  record,
  isChecking,
}: {
  record: DomainDnsRecord;
  isChecking: boolean;
}) {
  if (isChecking) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Spinner className="size-3.5" />
        Checking…
      </span>
    );
  }
  if (record.matched === true) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <CheckIcon className="size-3.5" />
        Confirmed
      </span>
    );
  }
  if (record.matched === null) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <CircleHelpIcon className="size-3.5" />
        Check unavailable
      </span>
    );
  }
  if (record.observedTargets.length > 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-600"
        title={`Found: ${record.observedTargets.join(', ')}`}
      >
        <TriangleAlertIcon className="size-3.5" />
        Different target
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <ClockIcon className="size-3.5" />
      Not visible yet
    </span>
  );
}
