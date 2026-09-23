import { Route as DeployRoute } from '#routes/deploy.tsx';

export function useDeployLink() {
  return DeployRoute.useSearch();
}
