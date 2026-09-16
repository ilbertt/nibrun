import { useSession } from '#lib/hooks/use-session.ts';

/** Whether the session is a stranger's: one made without an identity. */
export function useIsAnonymous(): boolean {
  return useSession()?.user.isAnonymous === true;
}
