import type { Deployed } from '@repo/app-operations';
import type { ReactNode } from 'react';
import { DeployRunContext } from '#lib/contexts/deploy-run-context.ts';
import { useRunApp } from '#lib/hooks/use-run-app.ts';

export function DeployRunProvider({
  children,
  onDeployed,
}: {
  children: ReactNode;
  onDeployed?: (deployed: Deployed) => void;
}) {
  const run = useRunApp({ onDeployed });

  return <DeployRunContext value={run}>{children}</DeployRunContext>;
}
