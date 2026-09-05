import { DEFAULT_LOG_TIMERANGE } from '@repo/protocol';
import { Link } from '@tanstack/react-router';
import { TriangleAlertIcon } from 'lucide-react';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import type { DeploymentSummary } from '#queries/deployments.ts';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

const UNEXPLAINED = 'It failed without saying why.';

export function FailedDeploymentNotice({ deployment }: { deployment: DeploymentSummary }) {
  const appId = useAppId();

  return (
    <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2 text-destructive text-sm">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <span className="wrap-anywhere">
        {deployment.message ?? UNEXPLAINED}{' '}
        <Link
          to={LogsRoute.to}
          params={{ appId }}
          search={{ timerange: DEFAULT_LOG_TIMERANGE }}
          className="font-medium underline underline-offset-4"
        >
          Your logs may have more details
        </Link>
        .
      </span>
    </p>
  );
}
