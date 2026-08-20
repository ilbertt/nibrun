import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { forgetHandedOffBinary } from '#lib/handoff-store.ts';
import { useDeployRun } from '#lib/hooks/use-deploy-run.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

/**
 * The handed-off deploy is the only one with nowhere to return to: it runs on a page outside
 * the dashboard, opened by a drop on another origin. Once it lands there is nothing left for
 * that page to be, so the binary is forgotten and the dashboard takes over.
 *
 * Leaving is not conditional on the forgetting: a browser that refuses the delete is no reason
 * to strand someone on a page whose work is done.
 */
export function useLeaveOnceDeployed(): void {
  const { phase } = useDeployRun();
  const navigate = useNavigate();

  useEffect(() => {
    if (phase !== 'done') {
      return;
    }
    void forgetHandedOffBinary().finally(() => navigate({ to: IndexRoute.to }));
  }, [phase, navigate]);
}
