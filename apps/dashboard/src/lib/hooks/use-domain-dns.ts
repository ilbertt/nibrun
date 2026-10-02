import { checkDomainDns } from '@repo/app-operations';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

type DomainDns = Awaited<ReturnType<typeof checkDomainDns>>;
const REFRESH_MS = 30_000;

export function useDomainDns({
  appId,
  hostname,
  pending,
}: {
  appId: string;
  hostname: string;
  pending: boolean;
}): UseQueryResult<DomainDns, Error> {
  return useQuery({
    queryKey: ['apps', appId, 'domain-dns', hostname],
    queryFn: () => checkDomainDns({ api, appId, hostname }),
    refetchInterval: pending ? REFRESH_MS : false,
    staleTime: REFRESH_MS,
  });
}
