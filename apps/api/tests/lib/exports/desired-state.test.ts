import { describe, expect, test } from 'bun:test';
import {
  ExportIdSchema,
  type ExportState,
  FilenameSchema,
  ObjectKeySchema,
  Sha256DigestSchema,
  Value,
} from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import {
  type DesiredExportRow,
  environmentByExport,
  toDesiredExport,
} from '#lib/exports/desired-state.ts';
import { type SealedEnvironment, sealEnvironment, sealedFromStore } from '#lib/tenant-secrets.ts';
import { APP_ID } from '#tests/services/support/fixtures.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

const EXPORT_ID = Value.Parse(ExportIdSchema, 'export-1');
const OBJECT_KEY = Value.Parse(ObjectKeySchema, `exports/${APP_ID}/${EXPORT_ID}.tar.gz`);
const ARTIFACT_OBJECT_KEY = Value.Parse(ObjectKeySchema, 'artifacts/abc');
const ARTIFACT_FILENAME = Value.Parse(FilenameSchema, 'pocketbase');
const ARTIFACT_DIGEST = Value.Parse(
  Sha256DigestSchema,
  'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298',
);
const ARTIFACT_SIZE_BYTES = 4096;
const OTHER_EXPORT = 'export-2';
const SECRET = 'sk-live-do-not-log-this';

type ExportEnvironmentRow = Queries['SelectDesiredExportEnvironment'];

function environmentRows(entries: Array<[string, string, string]>): ExportEnvironmentRow[] {
  return entries.map(
    ([exportId, name, value]) =>
      ({ export_id: exportId, name, value }) as unknown as ExportEnvironmentRow,
  );
}

function desired({
  state,
  environments = new Map(),
}: {
  state: ExportState;
  environments?: Map<string, SealedEnvironment>;
}) {
  return toDesiredExport({
    row: desiredExportRow(state),
    environments,
    secretsKey: TEST_SECRETS_KEY,
  });
}

function sealedFor({ exportId, name }: { exportId: string; name: string }) {
  return new Map([
    [
      exportId,
      sealEnvironment({ key: TEST_SECRETS_KEY, environment: { [name]: SECRET } as never }),
    ],
  ]);
}

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
    expect(desired({ state }).desiredState).toBe('present');
  });

  /**
   * The agent plans only over the exports it is sent, so one that simply stopped appearing would
   * be remembered — and reported — for as long as the host ran. Saying `absent` is what lets it
   * forget, and the row leaves only once the bundle has expired.
   */
  test.each(['ready', 'failed'] as const)('is to forget it once it is %s', (state) => {
    expect(desired({ state }).desiredState).toBe('absent');
  });

  // An app runs one microVM against one filesystem, so the volume is the app.
  test('names the volume the bundle is read from', () => {
    const bundle = desired({ state: 'pending' });

    expect(bundle.volumeId).toBe(APP_ID as string as typeof bundle.volumeId);
  });

  // The key came down from here, so the host writes exactly it and never reports one back.
  test('names the key the api will sign against', () => {
    expect(desired({ state: 'pending' }).objectKey).toBe(OBJECT_KEY);
  });

  // A stopped app has no instance to take a binary from, so the artifact rides along.
  test('carries the binary that belongs in the bundle', () => {
    expect(desired({ state: 'pending' }).artifact).toEqual({
      digest: ARTIFACT_DIGEST,
      sizeBytes: ARTIFACT_SIZE_BYTES,
      objectKey: ARTIFACT_OBJECT_KEY,
      filename: ARTIFACT_FILENAME,
    });
  });
});

// The bundle is what an owner runs elsewhere, so the variables the binary was configured with go
// with it — and this is the last point at which they are anything but ciphertext.
describe('the environment that belongs in the bundle', () => {
  test('is opened on its way out', () => {
    const bundle = desired({
      state: 'pending',
      environments: sealedFor({ exportId: EXPORT_ID, name: 'API_KEY' }),
    });

    expect(bundle.environment).toEqual({ API_KEY: SECRET } as never);
  });

  test('is empty for an export nothing was stored for', () => {
    expect(desired({ state: 'pending' }).environment).toEqual({});
  });

  /**
   * A host being told to forget an export has already written the bundle those variables are in,
   * so sending them again would put a tenant's secrets on the wire with nothing to do with them.
   */
  test.each(['ready', 'failed'] as const)('never goes down with an export that is %s', (state) => {
    const bundle = desired({
      state,
      environments: sealedFor({ exportId: EXPORT_ID, name: 'API_KEY' }),
    });

    expect(bundle.environment).toEqual({});
  });
});

describe('a relation of many rows becomes one environment per export', () => {
  test('every variable of an export lands under it', () => {
    const grouped = environmentByExport(
      environmentRows([
        [EXPORT_ID, 'A', 'one'],
        [EXPORT_ID, 'B', 'two'],
      ]),
    );

    expect(grouped.get(EXPORT_ID)).toEqual({
      A: sealedFromStore('one'),
      B: sealedFromStore('two'),
    });
  });

  // Two exports of the same app pin the same config version, so what separates them is the export.
  test('two exports do not share one environment', () => {
    const grouped = environmentByExport(
      environmentRows([
        [EXPORT_ID, 'A', 'mine'],
        [OTHER_EXPORT, 'A', 'theirs'],
      ]),
    );

    expect(grouped.get(EXPORT_ID)).toEqual({ A: sealedFromStore('mine') });
    expect(grouped.get(OTHER_EXPORT)).toEqual({ A: sealedFromStore('theirs') });
  });
});
