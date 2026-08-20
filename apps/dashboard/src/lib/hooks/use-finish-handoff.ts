import { useNavigate } from '@tanstack/react-router';
import { forgetHandedOffBinary } from '#lib/handoff-store.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

/**
 * What to do once a handed-off binary has been deployed. It is the only deploy with nowhere to
 * return to: it runs on a page outside the dashboard, opened by a drop on another origin, and
 * the binary that page exists for is spent the moment it lands.
 *
 * Leaving is not conditional on the forgetting: a browser that refuses the delete is no reason
 * to strand someone on a page whose work is done.
 */
export function useFinishHandoff(): () => void {
  const navigate = useNavigate();

  return function finish(): void {
    void forgetHandedOffBinary().finally(() => navigate({ to: IndexRoute.to }));
  };
}
