import type { DeployLink } from '#lib/deploy-link.ts';
import { Route as DeployRoute } from '#routes/deploy.tsx';

export function useDeployLink(): DeployLink {
  return DeployRoute.useSearch();
}
