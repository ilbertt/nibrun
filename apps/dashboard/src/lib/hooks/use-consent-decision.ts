import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { signedQuery } from '#lib/oauth.ts';

export type ConsentDecision = 'allow' | 'refuse';

/**
 * Answer the authorize request the owner was sent here by.
 *
 * The whole query string goes back rather than the code alone: better-auth signed every parameter
 * of the request onto this url and verifies them back off it, so anything picked out and rebuilt
 * here would be a query whose signature no longer matches.
 *
 * Both answers end at the client's `redirect_uri` — a refusal is an answer the client is owed, not
 * a page the owner is left on — so this navigates rather than returning.
 */
export function useConsentDecision(): UseMutationResult<void, Error, ConsentDecision> {
  return useMutation({
    mutationFn: async (decision: ConsentDecision) => {
      const { data, error } = await authClient.oauth2.consent({
        accept: decision === 'allow',
        oauth_query: signedQuery(),
      });
      if (error) {
        throw new Error(error.message ?? 'That decision could not be recorded.');
      }
      if (!data?.url) {
        throw new Error('The authorization was recorded without saying where to send you back to.');
      }
      window.location.href = data.url;
    },
  });
}
