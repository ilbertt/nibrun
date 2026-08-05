import type {
  AppHostname,
  AppId,
  AppState,
  DesiredInstance,
  DesiredPresence,
  DesiredVolume,
  HostId,
} from '@repo/protocol';
import { toAppConfig, VOLUME_SIZE_BYTES } from '#lib/app-config.ts';
import type {
  AppVolumeRow,
  DeployedHostnameRow,
  RunningDeploymentRow,
} from '#repositories/desired-state.repository.ts';

/**
 * The fleet is one machine, sized by `app_host_count` in terraform and 1 for the foreseeable
 * future, so which host is asking never changes the answer. Its id is a constant rather than a
 * row: nothing has to register before the first deploy can be scheduled, and there is no
 * placement to record. The day there are two, this becomes a table and a scheduler.
 */
export const THE_APP_HOST = 'app-host-1' as HostId;

// Taking a filesystem away is only ever said outright, never implied by a list that got
// shorter, so an app is carried out as `absent` rather than dropped from the list.
const LEAVING: AppState[] = ['deleting', 'deleted'];

export function toDesiredVolume(row: AppVolumeRow): DesiredVolume {
  const desiredState: DesiredPresence = LEAVING.includes(row.state) ? 'absent' : 'present';
  return {
    volumeId: volumeOf(row.id),
    appId: row.id,
    sizeBytes: VOLUME_SIZE_BYTES,
    desiredState,
  };
}

/**
 * One deployment is one microVM, so the deployment is the instance and its id is the instance
 * id. The two are separate ids in the protocol because a deployment could one day run several,
 * and on the day it does this is the line that stops being true.
 */
export function toDesiredInstance({
  row,
  hostnames,
}: {
  row: RunningDeploymentRow;
  hostnames: AppHostname[];
}): DesiredInstance {
  return {
    instanceId: row.id as string as DesiredInstance['instanceId'],
    appId: row.app_id,
    deploymentId: row.id,
    volumeId: volumeOf(row.app_id),
    desiredState: 'running',
    artifact: {
      digest: row.digest,
      sizeBytes: Number(row.size_bytes),
      objectKey: row.object_key,
      filename: row.original_file_name,
    },
    // Secrets storage is deferred, so the api has none to send and the guest is given none.
    config: { ...toAppConfig(row), environment: {} },
    hostnames,
  };
}

export function hostnamesByApp(rows: DeployedHostnameRow[]): Map<AppId, AppHostname[]> {
  const byApp = new Map<AppId, AppHostname[]>();
  for (const row of rows) {
    const existing = byApp.get(row.app_id) ?? [];
    existing.push({ hostname: row.hostname, kind: row.kind });
    byApp.set(row.app_id, existing);
  }
  return byApp;
}

// One filesystem per app, so the app is what identifies it. Nothing stores the pairing because
// there is nothing to store: it is the same string.
function volumeOf(appId: AppId): DesiredVolume['volumeId'] {
  return appId as string as DesiredVolume['volumeId'];
}
