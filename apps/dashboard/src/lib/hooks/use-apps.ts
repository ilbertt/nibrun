import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useSession } from '#lib/hooks/use-session.ts';
import { type AppSummary, appsQueryOptions } from '#queries/apps.ts';

/**
 * Not asked without a session: the deploy page renders for a visitor who has none yet, and a
 * listing the api would only refuse is a refusal retried in the background for nothing.
 */
export function useApps(): UseQueryResult<AppSummary[], Error> {
  const session = useSession();
  return useQuery({ ...appsQueryOptions, enabled: session !== null });
}
