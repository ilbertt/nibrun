import type { DeploymentId, HostId } from '@repo/protocol';
import type { DeploymentHostsRepositoryContract } from '#repositories/deployment-hosts.repository.ts';

export function deploymentHostsRepository({
  hostId,
  deploymentId,
}: {
  hostId: HostId | undefined;
  deploymentId: DeploymentId;
}): DeploymentHostsRepositoryContract {
  return {
    currentForApp() {
      return Promise.resolve(
        hostId === undefined ? null : { host_id: hostId, deployment_id: deploymentId },
      );
    },
  };
}
