import { Route } from '#routes/__root.tsx';

export function useSession() {
  return Route.useRouteContext().session;
}
