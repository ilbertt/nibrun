import type { DesiredExport, TenantEnvironment } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { volumeIdOf } from '#lib/deployments/desired-state.ts';
import { createLogger } from '#lib/logger.ts';
import {
  openEnvironment,
  type SealedEnvironment,
  sealedEnvironmentBy,
  type TenantSecretsKey,
} from '#lib/tenant-secrets.ts';

const logger = createLogger('desiredExports');

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
    // Only for a bundle still to be written: a host being told to forget one has already written
    // it, so sending the owner's variables again would put secrets on the wire to no end.
    environment:
      desiredState === 'present' ? bundleEnvironment({ row, environments, secretsKey }) : undefined,
    desiredState,
  };
}

/**
 * Absent rather than empty wherever this end cannot say what the app was configured with — an
 * export taken before the config version was recorded, or one whose values will not open — because
 * an empty environment is the answer for an app that set none, and these are not that.
 *
 * The second case is why this catches at all. `openEnvironment` raises on a value it cannot open,
 * which is right for an instance: one started with the wrong environment is worse than one not
 * started. Here it would fail the whole poll, and with it the convergence of every app on every
 * host, over one bundle's `.env`.
 */
function bundleEnvironment({
  row,
  environments,
  secretsKey,
}: {
  row: DesiredExportRow;
  environments: Map<string, SealedEnvironment>;
  secretsKey: TenantSecretsKey;
}): TenantEnvironment | undefined {
  if (row.config_id === null) {
    return undefined;
  }
  try {
    return openEnvironment({ key: secretsKey, sealed: environments.get(row.id) ?? {} });
  } catch (cause) {
    // The message and never the value: these come back as fixed strings from the envelope check
    // or as a GCM authentication failure, neither of which carries what was sealed.
    logger.error('an export environment could not be opened', {
      exportId: row.id,
      reason: cause instanceof Error ? cause.message : cause,
    });
    return undefined;
  }
}
