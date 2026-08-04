import type { AppHostname, AppId, HostPort } from '@repo/protocol';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

export type RouteTarget = {
  readonly appId: AppId;
  readonly hostnames: readonly AppHostname[];
  readonly hostPort: HostPort;
};

/** Only a tenant that has answered is routable: a booted-but-dead VM must never take traffic. */
export function renderableRoutes(records: readonly InstanceRecord[]): RouteTarget[] {
  return records
    .filter((record) => record.state === 'running' && record.hostnames.length > 0)
    .map((record) => ({
      appId: record.appId,
      hostnames: record.hostnames,
      hostPort: record.hostPort,
    }));
}
