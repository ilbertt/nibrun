import { useRouteContext } from '@tanstack/react-router';

/** The session the root guard already resolved, rather than a second read of it. */
export function useSession() {
  return useRouteContext({ from: '__root__' }).session;
}
