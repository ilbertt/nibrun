import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { authClient } from '#lib/auth.ts';

export function useOAuthConsentDecision(): UseMutationResult<void, Error, boolean> {
  const oauthQuery = useLocation({ select: (location) => location.searchStr });
  return useMutation({
    mutationFn: async (accept: boolean) => {
      const { data, error } = await authClient.oauth2.consent({ accept, oauth_query: oauthQuery });
      if (error || !data) {
        throw new Error('Could not save your decision. Try again or restart the connection.');
      }
    },
  });
}
