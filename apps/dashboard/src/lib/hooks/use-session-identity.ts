import { useSession } from '#lib/hooks/use-session.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export function useSessionIdentity(): SessionIdentity {
  const session = useSession();

  if (session === null) {
    return SessionIdentity.Visitor;
  }
  // Null is a person with an identity: better-auth never wrote the column for a user from before
  // there were strangers.
  return session.user.isAnonymous === true ? SessionIdentity.Stranger : SessionIdentity.Person;
}
