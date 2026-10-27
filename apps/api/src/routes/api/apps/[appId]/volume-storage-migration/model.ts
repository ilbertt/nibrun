import { t } from 'elysia';
import { VolumeStorageMigrationSchema } from '#lib/api/volume-storage-migration.ts';

export const VolumeStorageMigrationResponseSchema = t.Object({
  migration: t.Nullable(VolumeStorageMigrationSchema),
});

export const CancelVolumeStorageMigrationQuerySchema = t.Pick(
  VolumeStorageMigrationSchema,
  ['configId'],
  { additionalProperties: false },
);
