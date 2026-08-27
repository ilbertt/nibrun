import type { AppHostname, AppId, HostPort } from '@repo/protocol';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

export type RouteTarget = {
  readonly appId: AppId;
  readonly hostnames: readonly AppHostname[];
  readonly hostPort: HostPort;
};

/**
 * Responsibility, not liveness: a host answers for every app it holds a slot for, up or down. The
 * block is the same either way, so stopping and starting an app rewrites no config and reloads no
 * proxy — and a hostname this host does own is answered rather than falling through to the
 * wildcard's 404, which is the answer for one it does not.
 *
 * What the loopback port leads to is the forward rule's decision. With it the guest answers,
 * without it the agent does.
 */
export function renderableRoutes(records: readonly InstanceRecord[]): RouteTarget[] {
  return records
    .filter((record) => record.hostnames.length > 0)
    .map((record) => ({
      appId: record.appId,
      hostnames: record.hostnames,
      hostPort: record.hostPort,
    }));
}
