import type { Deployed } from '@repo/app-operations';
import { useNavigate } from '@tanstack/react-router';
import { discardHandedOffBinary } from '#lib/handoff-store.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';

/**
 * What to do once a handed-off binary has been deployed. The page it ran on is outside the
 * dashboard, opened by a drop on another origin, and the binary it exists for is spent the moment
 * it lands — so what is left of it is thrown away and the app it became is where this goes.
 */
export function useFinishHandoff(): (deployed: Deployed) => void {
  const navigate = useNavigate();

  return function finish(deployed: Deployed): void {
    discardHandedOffBinary();
    void navigate({ to: AppRoute.to, params: { appId: deployed.appId } });
  };
}
