import type { ReactNode } from 'react';
import { DeployRunContext } from '#lib/contexts/deploy-run-context.ts';
import { useRunApp } from '#lib/hooks/use-run-app.ts';

export function DeployRunProvider({ children }: { children: ReactNode }) {
  const run = useRunApp();

  return <DeployRunContext value={run}>{children}</DeployRunContext>;
}
