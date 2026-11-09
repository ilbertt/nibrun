import { expect, test } from 'bun:test';
import { ExportIdSchema, SecretStringSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { emptyDataArchive } from '#lib/nibrunner/artifact.ts';
import { nibrunnerDesiredState } from '#lib/nibrunner/desired-state.ts';
import { UnsupportedNibrunnerFeature } from '#lib/nibrunner/failure.ts';
import {
  artifact,
  desiredCheckpoint,
  desiredExport,
  desiredInstance,
  desiredState,
  desiredVolume,
} from '#tests/support/fixtures.ts';
import { s3Storage } from '#tests/support/s3-storage.ts';

test('an empty initialization archive creates data under the legacy path without wrapping argv', async () => {
  const desired = desiredState({ volumes: [desiredVolume()], instances: [desiredInstance()] });
  const converted = nibrunnerDesiredState({ desired, revision: 'revision-1' });
  const archive = emptyDataArchive();
  expect((await new Bun.Archive(archive.bytes).files()).size).toBe(0);
  expect(converted.volumes[0]?.initialContents).toEqual({
    digest: archive.digest,
    objectKey: archive.objectKey,
    destinationPath: '/app/data',
  });
  expect(converted.instances[0]?.config.command.program).toBe('/mnt/artifact/server');
  expect(converted.instances[0]?.config.command.args).toEqual(desired.instances[0]?.config.args);
  expect(nibrunnerDesiredState({ desired, revision: 'revision-1' })).toEqual(converted);
});

test('seed archives target the data directory rather than the overlay root', () => {
  const seed = artifact();
  const volume = desiredVolume({ seed });
  const converted = nibrunnerDesiredState({
    desired: desiredState({ volumes: [volume] }),
    revision: 'seed',
  });
  expect(converted.volumes[0]?.initialContents).toEqual({
    digest: seed.digest,
    objectKey: seed.digest,
    destinationPath: '/app/data',
  });
  expect(converted.volumes[0]?.sizeBytes).toBe(volume.sizeBytes);
});

test('host ownership, explicit volume deletion and checkpoint identity remain authoritative', () => {
  const checkpoint = desiredCheckpoint();
  const volume = desiredVolume({ desiredState: 'absent' });
  const desired = desiredState({ volumes: [volume], checkpoints: [checkpoint] });
  const converted = nibrunnerDesiredState({ desired, revision: 'delete' });
  expect(converted.hostId).toBe(desired.hostId);
  expect(converted.revision).toBe('delete');
  expect(converted.volumes[0]?.desiredState).toBe('absent');
  expect(converted.volumes[0]?.volumeId).toBe(volume.volumeId);
  expect(converted.checkpoints).toEqual([checkpoint]);
  expect(nibrunnerDesiredState({ desired: desiredState(), revision: 'empty' }).volumes).toEqual([]);
});

test('private storage is refused instead of falling back to another backend', () => {
  const privateVolume = desiredVolume({ storage: s3Storage() });
  expect(function translateStorage() {
    nibrunnerDesiredState({
      desired: desiredState({ volumes: [privateVolume] }),
      revision: 'private',
    });
  }).toThrow(UnsupportedNibrunnerFeature);
});

test('native exports retain configuration but use private local keys without the executable', () => {
  const item = desiredExport({
    environment: { DATABASE_PATH: Value.Parse(SecretStringSchema, 'data/app.db') },
  });
  const converted = nibrunnerDesiredState({
    desired: desiredState({ exports: [item] }),
    revision: 'export',
  });
  expect(converted.exports).toEqual([
    {
      exportId: item.exportId,
      appId: item.appId,
      volumeId: item.volumeId,
      desiredState: item.desiredState,
      format: 'directory',
      environment: item.environment,
      objectKey: `${item.exportId}.export`,
    },
  ]);
});

test('only the oldest pending export reaches the engine while acknowledgements remain visible', () => {
  const oldest = desiredExport({ exportId: Value.Parse(ExportIdSchema, 'export-1') });
  const queued = desiredExport({ exportId: Value.Parse(ExportIdSchema, 'export-2') });
  const absent = desiredExport({
    exportId: Value.Parse(ExportIdSchema, 'export-0'),
    desiredState: 'absent',
  });
  const converted = nibrunnerDesiredState({
    desired: desiredState({ exports: [queued, absent, oldest] }),
    revision: 'queued',
  });
  expect(converted.exports.map((item) => item.exportId)).toEqual([
    absent.exportId,
    oldest.exportId,
  ]);
  expect(converted.exports.every((item) => item.format === 'directory')).toBe(true);
  const next = nibrunnerDesiredState({
    desired: desiredState({ exports: [queued, absent, { ...oldest, desiredState: 'absent' }] }),
    revision: 'acknowledged',
  });
  expect(next.exports.filter((item) => item.desiredState === 'present')).toMatchObject([
    { exportId: queued.exportId },
  ]);
});
