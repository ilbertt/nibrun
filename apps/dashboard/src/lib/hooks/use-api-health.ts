import { useQuery } from '@tanstack/react-query';
import { healthQueryOptions, type SystemComponents, type SystemHealth } from '#queries/health.ts';

/**
 * The api's own two verdicts, plus the two states only this end can be in: it has not asked yet,
 * or it asked and got nothing. An api that does not answer reports no components, which is why
 * they arrive together with the state that has them rather than beside it.
 */
export type ApiHealth =
  | { state: 'checking' | 'unreachable'; components?: undefined }
  | { state: SystemHealth['status']; components: SystemComponents };

export function useApiHealth(): ApiHealth {
  const { data, isError } = useQuery(healthQueryOptions);

  if (isError) {
    return { state: 'unreachable' };
  }
  if (!data) {
    return { state: 'checking' };
  }
  return { state: data.status, components: data.components };
}
