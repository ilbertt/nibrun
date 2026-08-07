import { DEFAULT_LOG_TIMERANGE } from '@repo/protocol';
import { createFileRoute } from '@tanstack/react-router';
import { DeploymentLogs } from '#components/logs/deployment-logs.tsx';
import { isLogTimerangeChoice, type LogTimerangeChoice } from '#lib/log-timeranges.ts';

export type LogsSearch = { timerange: LogTimerangeChoice };

export const Route = createFileRoute('/(dashboard)/apps/$appId/logs')({
  validateSearch: (search: Record<string, unknown>): LogsSearch => ({
    timerange: isLogTimerangeChoice(search.timerange) ? search.timerange : DEFAULT_LOG_TIMERANGE,
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <DeploymentLogs />;
}
