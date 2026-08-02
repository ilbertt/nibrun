import type { Session } from '#lib/auth.ts';
import { Route } from '#routes/__root.tsx';

export function useSession(): Session | null {
  return Route.useRouteContext().session;
}
