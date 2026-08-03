import type { AppHostname, AppId, HostPort } from '@repo/protocol';
import type { InstanceRecord } from '#report/instance-record.ts';

export type RouteTarget = {
  appId: AppId;
  hostnames: AppHostname[];
  hostPort: HostPort;
};

/**
 * Everything the local user-app proxy needs, derived from the same records the boot path writes,
 * so its config is a projection of what the host is running rather than a second copy of it —
 * which is what leaves no room for the two to drift.
 *
 * Only instances whose tenant has actually answered are routable: sending traffic to a booted
 * but dead VM is the failure the `starting`/`running` distinction exists to prevent.
 */
export function renderableRoutes(records: readonly InstanceRecord[]): RouteTarget[] {
  return records
    .filter((record) => record.state === 'running' && record.hostnames.length > 0)
    .map((record) => ({
      appId: record.appId,
      hostnames: record.hostnames,
      hostPort: record.hostPort,
    }));
}
