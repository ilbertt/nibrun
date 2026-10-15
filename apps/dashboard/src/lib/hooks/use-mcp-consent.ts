import { mcpAnalyticsAttempt, setAnalyticsAccountId, trackEvent } from '@repo/analytics';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { authClient } from '#lib/auth.ts';
import { useSession } from '#lib/hooks/use-session.ts';

type McpConsent = {
  clientName: string;
  loading: boolean;
  unavailable: boolean;
  pending: boolean;
  failed: boolean;
  decide: (accept: boolean) => void;
};

export function useMcpConsent(): McpConsent {
  const session = useSession();
  const query = window.location.search.slice(1);
  const parameters = new URLSearchParams(query);
  const clientId = parameters.get('client_id');
  const signed = parameters.has('sig');
  const client = useQuery({
    queryKey: ['mcp-consent-client', clientId],
    enabled: Boolean(clientId && signed),
    queryFn: async () => {
      const result = await authClient.oauth2.publicClient({ query: { client_id: clientId! } });
      if (result.error) {
        throw new Error('This authorization request is unavailable.');
      }
      return result.data;
    },
    retry: false,
  });
  const decision = useMutation({
    mutationFn: async (accept: boolean) => {
      const result = await authClient.oauth2.consent({ accept, oauth_query: query });
      const data = result.data;
      const redirectUri =
        data && ('redirect_uri' in data ? data.redirect_uri : 'url' in data ? data.url : undefined);
      if (result.error || typeof redirectUri !== 'string') {
        throw new Error('Could not complete authorization. Please try again.');
      }
      window.location.assign(redirectUri);
    },
  });
  const accountId = session?.user.isAnonymous ? undefined : session?.user.id;
  useEffect(() => {
    const attemptId = mcpAnalyticsAttempt();
    if (client.isSuccess && accountId && attemptId) {
      setAnalyticsAccountId(accountId);
      trackEvent({ name: 'mcp_consent_viewed', data: { source: 'mcp', attempt_id: attemptId } });
    }
  }, [client.isSuccess, accountId]);

  return {
    clientName: client.data?.client_name ?? 'This MCP client',
    loading: Boolean(clientId && signed) && client.isPending,
    unavailable: !clientId || !signed || client.isError || !accountId,
    pending: decision.isPending,
    failed: decision.isError,
    decide: decision.mutate,
  };
}
