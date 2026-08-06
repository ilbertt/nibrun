import type {
  AppConfig,
  AppHostname,
  AppId,
  DesiredInstance,
  DesiredVolume,
  VolumeId,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { toAppConfig, VOLUME_SIZE_BYTES } from '#lib/app-config.ts';

export type DesiredDeploymentRow = Queries['SelectDesiredDeployments'];

export type DesiredHostnameRow = Queries['SelectDesiredHostnames'];

export type DesiredVolumeRow = Queries['SelectDesiredVolumes'];

/**
 * The app's own id, because an app has one filesystem and the two never differ. Kept a type apart
 * so an app holding a second one later is a schema change rather than a wire change.
 */
function volumeIdOf(appId: AppId): VolumeId {
  return appId as string as VolumeId;
}

/**
 * A suspended app keeps its filesystem — that is what suspending it means — so deleting the app
 * is the only thing that asks for one to go, and it asks by saying so. A volume is never removed
 * by falling out of a list.
 */
export function toDesiredVolume(row: DesiredVolumeRow): DesiredVolume {
  return {
    volumeId: volumeIdOf(row.app_id),
    appId: row.app_id,
    sizeBytes: VOLUME_SIZE_BYTES,
    desiredState: row.state === 'deleting' ? 'absent' : 'present',
  };
}

/**
 * An app runs one microVM, so the instance is the app: the agent plans a `replace` when `appId`
 * holds still and `deploymentId` moves, and a replace stops the old microVM before starting the
 * new one. Were a microVM named after its deployment instead, a redeploy would be a start and a
 * stop under two different names, and the host would boot the second while the first still held
 * the volume and the port.
 */
export function toDesiredInstance({
  row,
  hostnames,
}: {
  row: DesiredDeploymentRow;
  hostnames: Map<AppId, AppHostname[]>;
}): DesiredInstance {
  return {
    appId: row.app_id,
    deploymentId: row.id,
    volumeId: volumeIdOf(row.app_id),
    desiredState: row.state === 'active' ? 'running' : 'stopped',
    artifact: {
      digest: row.digest,
      sizeBytes: Number(row.size_bytes),
      objectKey: row.object_key,
      filename: row.original_file_name,
    },
    config: toDesiredConfig(row),
    hostnames: hostnames.get(row.app_id) ?? [],
  };
}

export function hostnamesByApp(rows: DesiredHostnameRow[]): Map<AppId, AppHostname[]> {
  const byApp = new Map<AppId, AppHostname[]>();
  for (const row of rows) {
    byApp.set(row.app_id, [
      ...(byApp.get(row.app_id) ?? []),
      { hostname: row.hostname, kind: row.kind },
    ]);
  }
  return byApp;
}

// `environment` is empty because secrets storage is deferred, and `volumeSizeBytes` is the
// owner's view of the volume the host is told about separately.
function toDesiredConfig(row: DesiredDeploymentRow): AppConfig {
  const { guestPort, args, resources, healthCheck, restartPolicy } = toAppConfig(row);
  return { guestPort, args, resources, healthCheck, restartPolicy, environment: {} };
}
