import { useQuery } from '@tanstack/react-query';
import { healthQueryOptions } from '#queries/health.ts';

export type ApiHealth =
  | { status: 'checking' | 'unreachable'; uptimeSeconds?: undefined }
  | { status: 'reachable'; uptimeSeconds: number };

export function useApiHealth(): ApiHealth {
  const { data, isError } = useQuery(healthQueryOptions);

  if (isError) {
    return { status: 'unreachable' };
  }
  if (!data) {
    return { status: 'checking' };
  }
  return { status: 'reachable', uptimeSeconds: data.uptime };
}
