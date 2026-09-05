import {
  type AppConfig,
  type AppHostname,
  type AppId,
  DEFAULT_VOLUME_SIZE_BYTES,
  type DesiredInstance,
  type DesiredInstanceState,
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
 *
 * The seed rides along only while the view still offers one, which is until a host has said the
 * filesystem exists. A host that already has one ignores it, so this is about what crosses the
 * wire rather than about what would happen if it did.
 */
export function toDesiredVolume(row: DesiredVolumeRow): DesiredVolume {
  return {
    volumeId: volumeIdOf(row.app_id),
    appId: row.app_id,
    sizeBytes: DEFAULT_VOLUME_SIZE_BYTES,
    desiredState: row.state === 'deleting' ? 'absent' : 'present',
    ...seedOf(row),
  };
}

/**
 * All four columns or none: the view fills them from one row of `imports` and leaves them all null
 * where there is none, so a partly filled seed is not a state this can be handed.
 */
function seedOf(row: DesiredVolumeRow): Pick<DesiredVolume, 'seed'> {
  if (
    row.seed_digest === null ||
    row.seed_size_bytes === null ||
    row.seed_object_key === null ||
    row.seed_original_file_name === null
  ) {
    return {};
  }
  return {
    seed: {
      digest: row.seed_digest,
      sizeBytes: Number(row.seed_size_bytes),
      objectKey: row.seed_object_key,
      filename: row.seed_original_file_name,
    },
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
  const desiredState = desiredInstanceState(row);
  return {
    appId: row.app_id,
    deploymentId: row.id,
    volumeId: volumeIdOf(row.app_id),
    desiredState,
    // Left out for an app whose microVM is kept up either way, so a host is never handed a
    // timeout it would be wrong to act on.
    ...(desiredState === 'on-request' ? { idleTimeoutMs: row.idle_timeout_ms } : {}),
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

/**
 * Suspended wins over any activation policy: an owner who has stopped their app has said the
 * microVM should be down, and `on-request` would have the next stranger to find the hostname
 * start it again.
 *
 * A failed release is `stopped` for the same reason and not the same one: nobody asked for it to
 * be down, but there is nothing here that running it again would fix, and `on-request` would have
 * every visitor pay for a boot the last one already proved. It stays in this list only so the
 * host goes on answering for the hostnames — the activator's 503 is the honest answer to a
 * release that did not come up, and it is the owner's redeploy that ends it.
 */
function desiredInstanceState(row: DesiredDeploymentRow): DesiredInstanceState {
  if (row.deployment_state === 'failed' || row.state !== 'active') {
    return 'stopped';
  }
  return row.activation === 'on-request' ? 'on-request' : 'running';
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
