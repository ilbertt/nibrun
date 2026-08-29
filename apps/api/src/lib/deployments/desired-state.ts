import {
  type AppConfig,
  type AppHostname,
  type AppId,
  DEFAULT_VOLUME_SIZE_BYTES,
  type DesiredInstance,
  type DesiredVolume,
  Value,
  type VolumeId,
  VolumeIdSchema,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { toRunConfig } from '#lib/app-config.ts';
import {
  openEnvironment,
  type SealedEnvironment,
  sealedEnvironmentBy,
  type TenantSecretsKey,
} from '#lib/tenant-secrets.ts';

export type DesiredDeploymentRow = Queries['SelectDesiredDeployments'];

export type DesiredHostnameRow = Queries['SelectDesiredHostnames'];

export type DesiredVolumeRow = Queries['SelectDesiredVolumes'];

/**
 * The app's own id, because an app has one filesystem and the two never differ. Kept a type apart
 * so an app holding a second one later is a schema change rather than a wire change.
 */
export function volumeIdOf(appId: AppId): VolumeId {
  return Value.Parse(VolumeIdSchema, appId);
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
    sizeBytes: DEFAULT_VOLUME_SIZE_BYTES,
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
  environments,
  secretsKey,
}: {
  row: DesiredDeploymentRow;
  hostnames: Map<AppId, AppHostname[]>;
  environments: Map<string, SealedEnvironment>;
  secretsKey: TenantSecretsKey;
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
    config: toDesiredConfig({
      row,
      sealed: environments.get(row.id) ?? {},
      secretsKey,
    }),
    hostnames: hostnames.get(row.app_id) ?? [],
  };
}

export type DesiredEnvironmentRow = Queries['SelectDesiredEnvironment'];

/** Grouped the way hostnames are, for the same reason: one relation, many rows per instance. */
export function environmentByDeployment(
  rows: DesiredEnvironmentRow[],
): Map<string, SealedEnvironment> {
  return sealedEnvironmentBy({ rows, owner: (row) => row.deployment_id });
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

// The one place a tenant's environment is in the clear, and the last moment it can be: past here
// it is on its way to the host that runs the binary. `volumeSizeBytes` is dropped because it is
// the owner's view of a volume the host is told about separately.
function toDesiredConfig({
  row,
  sealed,
  secretsKey,
}: {
  row: DesiredDeploymentRow;
  sealed: SealedEnvironment;
  secretsKey: TenantSecretsKey;
}): AppConfig {
  return {
    ...toRunConfig(row),
    environment: openEnvironment({ key: secretsKey, sealed }),
  };
}
