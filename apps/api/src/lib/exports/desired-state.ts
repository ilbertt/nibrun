import type { DesiredExport } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { volumeIdOf } from '#lib/deployments/desired-state.ts';

export type DesiredExportRow = Queries['SelectDesiredExports'];

/**
 * A finished export is `absent` rather than dropped, because the agent plans only over the exports
 * it is sent: one that simply stopped appearing would be remembered — and reported — for as long
 * as the host ran. Saying so is what lets it forget.
 */
export function toDesiredExport(row: DesiredExportRow): DesiredExport {
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
    desiredState: row.state === 'pending' || row.state === 'preparing' ? 'present' : 'absent',
  };
}
