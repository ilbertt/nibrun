import type { AppHostname, AppId, HostPort } from '@repo/protocol';
import { waitingPort } from '#lib/proxy/listener.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';

export type RouteTarget = {
  readonly appId: AppId;
  readonly hostnames: readonly AppHostname[];
  readonly hostPort: HostPort;
};

export function renderableRoutes({
  records,
  replacing,
}: {
  records: readonly InstanceRecord[];
  replacing: ReadonlyMap<AppId, InstanceRecord>;
}): RouteTarget[] {
  const held = new Map(replacing);
  for (const record of records) {
    held.set(record.appId, record);
  }
  return [...held.values()]
    .filter((record) => record.hostnames.length > 0)
    .map((record) => ({
      appId: record.appId,
      hostnames: record.hostnames,
      hostPort:
        replacing.has(record.appId) || record.state === 'pending' || record.state === 'starting'
          ? waitingPort(record.hostPort)
          : record.hostPort,
    }));
}
