import type { DesiredExport } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { volumeIdOf } from '#lib/deployments/desired-state.ts';
import {
  openEnvironment,
  type SealedEnvironment,
  sealedEnvironmentBy,
  type TenantSecretsKey,
} from '#lib/tenant-secrets.ts';

export type DesiredExportRow = Queries['SelectDesiredExports'];

export type DesiredExportEnvironmentRow = Queries['SelectDesiredExportEnvironment'];

/** Grouped as a deployment's is, and separately: an export pins a config version of its own. */
export function environmentByExport(
  rows: DesiredExportEnvironmentRow[],
): Map<string, SealedEnvironment> {
  return sealedEnvironmentBy({ rows, owner: (row) => row.export_id });
}

/**
 * A finished export is `absent` rather than dropped, because the agent plans only over the exports
 * it is sent: one that simply stopped appearing would be remembered — and reported — for as long
 * as the host ran. Saying so is what lets it forget.
 */
export function toDesiredExport({
  row,
  environments,
  secretsKey,
}: {
  row: DesiredExportRow;
  environments: Map<string, SealedEnvironment>;
  secretsKey: TenantSecretsKey;
}): DesiredExport {
  const desiredState = row.state === 'pending' || row.state === 'preparing' ? 'present' : 'absent';
  return {
    exportId: row.id,
    appId: row.app_id,
    volumeId: volumeIdOf(row.app_id),
    objectKey: row.object_key,
    artifact: {
      digest: row.digest,
      sizeBytes: Number(row.size_bytes),
      objectKey: row.artifact_object_key,
      filename: row.original_file_name,
    },
    // Opened only for a bundle still to be written. A host being told to forget one has already
    // written it, so sending the owner's variables again would put secrets on the wire to no end.
    environment:
      desiredState === 'present'
        ? openEnvironment({ key: secretsKey, sealed: environments.get(row.id) ?? {} })
        : {},
    desiredState,
  };
}
