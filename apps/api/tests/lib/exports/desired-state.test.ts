import { describe, expect, test } from 'bun:test';
import {
  ExportIdSchema,
  type ExportState,
  FilenameSchema,
  ObjectKeySchema,
  Sha256DigestSchema,
  Value,
} from '@repo/protocol';
import { type DesiredExportRow, toDesiredExport } from '#lib/exports/desired-state.ts';
import { APP_ID } from '#tests/services/support/fixtures.ts';

const EXPORT_ID = Value.Parse(ExportIdSchema, 'export-1');
const OBJECT_KEY = Value.Parse(ObjectKeySchema, `exports/${APP_ID}/${EXPORT_ID}.tar.gz`);
const ARTIFACT_OBJECT_KEY = Value.Parse(ObjectKeySchema, 'artifacts/abc');
const ARTIFACT_FILENAME = Value.Parse(FilenameSchema, 'pocketbase');
const ARTIFACT_DIGEST = Value.Parse(
  Sha256DigestSchema,
  'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298',
);
const ARTIFACT_SIZE_BYTES = 4096;

function desiredExportRow(state: ExportState): DesiredExportRow {
  return {
    id: EXPORT_ID,
    app_id: APP_ID,
    object_key: OBJECT_KEY,
    state,
    digest: ARTIFACT_DIGEST,
    size_bytes: String(ARTIFACT_SIZE_BYTES),
    artifact_object_key: ARTIFACT_OBJECT_KEY,
    original_file_name: ARTIFACT_FILENAME,
  };
}

describe('what a host is told to do about an export', () => {
  test.each(['pending', 'preparing'] as const)('is to write it while it is %s', (state) => {
    expect(toDesiredExport(desiredExportRow(state)).desiredState).toBe('present');
  });

  /**
   * The agent plans only over the exports it is sent, so one that simply stopped appearing would
   * be remembered — and reported — for as long as the host ran. Saying `absent` is what lets it
   * forget, and the row leaves only once the bundle has expired.
   */
  test.each(['ready', 'failed'] as const)('is to forget it once it is %s', (state) => {
    expect(toDesiredExport(desiredExportRow(state)).desiredState).toBe('absent');
  });

  // An app runs one microVM against one filesystem, so the volume is the app.
  test('names the volume the bundle is read from', () => {
    const desired = toDesiredExport(desiredExportRow('pending'));

    expect(desired.volumeId).toBe(APP_ID as string as typeof desired.volumeId);
  });

  // The key came down from here, so the host writes exactly it and never reports one back.
  test('names the key the api will sign against', () => {
    expect(toDesiredExport(desiredExportRow('pending')).objectKey).toBe(OBJECT_KEY);
  });

  // A stopped app has no instance to take a binary from, so the artifact rides along.
  test('carries the binary that belongs in the bundle', () => {
    expect(toDesiredExport(desiredExportRow('pending')).artifact).toEqual({
      digest: ARTIFACT_DIGEST,
      sizeBytes: ARTIFACT_SIZE_BYTES,
      objectKey: ARTIFACT_OBJECT_KEY,
      filename: ARTIFACT_FILENAME,
    });
  });
});
