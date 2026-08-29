import type { DeployLink } from '@repo/deploy-link';
import { Route as DeployRoute } from '#routes/deploy.tsx';

export function useDeployLink(): DeployLink {
  return DeployRoute.useSearch();
}
