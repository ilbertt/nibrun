import { join } from 'node:path';
import type { AppId, DeploymentId, InstanceId } from '@repo/protocol';

export const TENANT_LOG_VSOCK_PORT = 51000;
export const TENANT_LOG_VSOCK_FILENAME = 'logs.vsock';

export type TenantLogSource = {
  readonly appId: AppId;
  readonly deploymentId: DeploymentId;
  readonly instanceId: InstanceId;
};

export const tenantLogSocketPath = ({ workingDir }: { workingDir: string }): string =>
  join(workingDir, `${TENANT_LOG_VSOCK_FILENAME}_${TENANT_LOG_VSOCK_PORT}`);
