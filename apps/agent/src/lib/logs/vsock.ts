import { join } from 'node:path';
import type { AppId, DeploymentId } from '@repo/protocol';
import { GUEST_VSOCK_FILENAME } from '#lib/vm/vsock.ts';

export const TENANT_LOG_VSOCK_PORT = 51000;

export type TenantLogSource = {
  readonly appId: AppId;
  readonly deploymentId: DeploymentId;
};

export const tenantLogSocketPath = ({ workingDir }: { workingDir: string }): string =>
  join(workingDir, `${GUEST_VSOCK_FILENAME}_${TENANT_LOG_VSOCK_PORT}`);
