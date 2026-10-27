import { t } from 'elysia';
import { OwnedAppStateSchema } from '#lib/api/app.ts';
import {
  VolumeStorageMigrationSchema,
  type VolumeStorageMigrationState,
} from '#lib/api/volume-storage-migration.ts';

// One transition per request prevents cancellation and suspension from being partially applied.
export const AppStateRequestSchema = t.Union([
  t.Object({ state: OwnedAppStateSchema }, { additionalProperties: false }),
  t.Object(
    {
      volumeStorageMigration: t.Object(
        {
          configId: VolumeStorageMigrationSchema.properties.configId,
          state: t.Literal('cancelled' satisfies VolumeStorageMigrationState),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
