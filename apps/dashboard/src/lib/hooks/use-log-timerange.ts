import type { LogTimerangeChoice } from '#lib/log-timeranges.ts';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

export function useLogTimerange(): LogTimerangeChoice {
  return LogsRoute.useSearch().timerange;
}
