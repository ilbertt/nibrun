import { t } from 'elysia';
import { VolumeStorageMigrationSchema } from '#lib/api/volume-storage-migration.ts';

export const CancelVolumeStorageMigrationQuerySchema = t.Pick(
  VolumeStorageMigrationSchema,
  ['configId'],
  { additionalProperties: false },
);
