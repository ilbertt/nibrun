import { stringEnum } from '@repo/typebox-extensions';
import { Type } from '@sinclair/typebox';

export const VOLUME_STORAGE_MIGRATION_STATES = [
  'pending',
  'completed',
  'failed',
  'cancelled',
] as const;
export const VolumeStorageMigrationStateSchema = stringEnum(VOLUME_STORAGE_MIGRATION_STATES);
export type VolumeStorageMigrationState = typeof VolumeStorageMigrationStateSchema.static;

export const VolumeStorageMigrationSchema = Type.Object({
  configId: Type.String({
    minLength: 1,
    description: 'Pass this version back when cancelling to avoid cancelling a newer attempt.',
  }),
  state: VolumeStorageMigrationStateSchema,
  message: Type.Union([Type.String(), Type.Null()]),
  canCancel: Type.Boolean(),
});
export type VolumeStorageMigration = typeof VolumeStorageMigrationSchema.static;
