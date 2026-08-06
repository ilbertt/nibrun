import type {
  AppConfig,
  AppHostname,
  AppId,
  DesiredInstance,
  DesiredVolume,
  InstanceId,
  VolumeId,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { toAppConfig, VOLUME_SIZE_BYTES } from '#lib/app-config.ts';

export type DesiredDeploymentRow = Queries['SelectDesiredDeployments'];

export type DesiredHostnameRow = Queries['SelectDesiredHostnames'];

/**
 * An app runs one microVM over one filesystem, so both are the app rather than rows of their own.
 *
 * Naming the instance after the app is what makes a redeploy a `replace` on the host: the agent
 * plans one when `instanceId` holds still and `deploymentId` moves, and a replace stops the old
 * microVM before starting the new one. Named after the deployment instead, a redeploy would be a
 * start and a stop on two different ids, and the host would boot the second while the first
 * still held the volume and the port.
 */
function instanceIdOf(appId: AppId): InstanceId {
  return appId as string as InstanceId;
}

function volumeIdOf(appId: AppId): VolumeId {
  return appId as string as VolumeId;
}

/**
 * Always `present`. A suspended app keeps its filesystem — that is what suspending it means —
 * and removing one is the business of deleting the app, which says `absent` deliberately rather
 * than by leaving a volume out of a list.
 */
export function toDesiredVolume(row: DesiredDeploymentRow): DesiredVolume {
  return {
    volumeId: volumeIdOf(row.app_id),
    appId: row.app_id,
    sizeBytes: VOLUME_SIZE_BYTES,
    desiredState: 'present',
  };
}

export function toDesiredInstance({
  row,
  hostnames,
}: {
  row: DesiredDeploymentRow;
  hostnames: Map<AppId, AppHostname[]>;
}): DesiredInstance {
  return {
    instanceId: instanceIdOf(row.app_id),
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
