import { useAnalyticsSession } from '#lib/hooks/use-analytics-session.ts';

export function AnalyticsSession(): null {
  useAnalyticsSession();
  return null;
}
