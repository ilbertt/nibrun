import { Route as DeployRoute } from '#routes/deploy.tsx';

export function useHandedOffBinary(): File | undefined {
  return DeployRoute.useLoaderData();
}
