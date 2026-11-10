import { stringEnum } from '@repo/typebox-extensions';

export enum DeploymentInitiator {
  Owner = 'owner',
  SystemHostMigration = 'system.host-migration',
  SystemStorageMigration = 'system.storage-migration',
}

export const DeploymentInitiatorSchema = stringEnum<readonly `${DeploymentInitiator}`[]>(
  Object.values(DeploymentInitiator),
);
