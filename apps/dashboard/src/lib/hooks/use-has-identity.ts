import { useSession } from '#lib/hooks/use-session.ts';

/**
 * Whether the session is somebody's. A stranger's is not, and neither is the visit that has no
 * session yet: pressing deploy is what makes that visitor a stranger.
 */
export function useHasIdentity(): boolean {
  const session = useSession();
  return session !== null && session.user.isAnonymous !== true;
}
