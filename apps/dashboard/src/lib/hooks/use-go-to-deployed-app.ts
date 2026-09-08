import { useNavigate } from '@tanstack/react-router';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { Route as AppRoute } from '#routes/(dashboard)/apps/$appId/index.tsx';

/** Where a run that landed is followed to. A run that failed landed on no app to go to. */
export function useGoToDeployedApp(): () => void {
  const { deployed } = useDeployRun();
  const navigate = useNavigate();

  return function goToApp(): void {
    if (deployed !== undefined) {
      void navigate({ to: AppRoute.to, params: { appId: deployed.appId } });
    }
  };
}
