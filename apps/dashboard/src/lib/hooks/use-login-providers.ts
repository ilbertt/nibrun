import { unwrap } from '@repo/api-client/unwrap';
import { SignInProvider } from '@repo/api-constants';
import { useQuery } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export function useLoginProviders(): SignInProvider[] {
  const providers = useQuery({
    queryKey: ['login-providers'],
    queryFn: async () => unwrap(await api.api['login-providers'].get()),
  });
  return providers.data ?? [SignInProvider.GitHub];
}
