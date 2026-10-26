import { stringEnum } from '@repo/typebox-extensions';

export const VOLUME_STORAGE_MIGRATION_STATES = [
  'pending',
  'completed',
  'failed',
  'cancelled',
] as const;
export const VolumeStorageMigrationStateSchema = stringEnum(VOLUME_STORAGE_MIGRATION_STATES);
export type VolumeStorageMigrationState = typeof VolumeStorageMigrationStateSchema.static;
