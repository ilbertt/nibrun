import { useSession } from '#lib/hooks/use-session.ts';

/** Whether the session is a stranger's: one made without an identity, holding an app for an hour. */
export function useIsAnonymous(): boolean {
  return useSession()?.user.isAnonymous === true;
}
