import { Elysia } from 'elysia';
import { sql } from '#db/client.ts';
import { env } from '#lib/env.ts';
import { createLogger } from '#lib/logger.ts';
import { artifactsPolicySigner, artifactsS3, exportsS3 } from '#lib/s3/client.ts';
import { VictoriaLogsClient } from '#lib/victorialogs/client.ts';
import { AgentRepository } from '#repositories/agent.repository.ts';
import { AppsRepository } from '#repositories/apps.repository.ts';
import { ArtifactStorageRepository } from '#repositories/artifact-storage.repository.ts';
import { ArtifactsRepository } from '#repositories/artifacts.repository.ts';
import { AssetsRepository } from '#repositories/assets.repository.ts';
import { DeploymentsRepository } from '#repositories/deployments.repository.ts';
import { ExportStorageRepository } from '#repositories/export-storage.repository.ts';
import { ExportsRepository } from '#repositories/exports.repository.ts';
import { HealthRepository } from '#repositories/health.repository.ts';
import { LogsRepository } from '#repositories/logs.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import { AppsService } from '#services/apps.service.ts';
import { ArtifactsService } from '#services/artifacts.service.ts';
import { AssetsService } from '#services/assets.service.ts';
import { DeploymentsService } from '#services/deployments.service.ts';
import { ExportsService } from '#services/exports.service.ts';
import { FilesystemService } from '#services/filesystem.service.ts';
import { HealthService } from '#services/health.service.ts';
import { LogsService } from '#services/logs.service.ts';

const agentRepository = new AgentRepository(sql);
const assetsRepository = new AssetsRepository(sql);
const healthRepository = new HealthRepository(sql);
const appsRepository = new AppsRepository(sql);
const artifactsRepository = new ArtifactsRepository(sql);
const deploymentsRepository = new DeploymentsRepository(sql);
const artifactStorageRepository = new ArtifactStorageRepository({
  client: artifactsS3,
  policySigner: artifactsPolicySigner,
  bucket: env.ARTIFACTS_BUCKET,
});
const exportsRepository = new ExportsRepository(sql);
const exportStorageRepository = new ExportStorageRepository(exportsS3);
const logsRepository = new LogsRepository(new VictoriaLogsClient(env.VICTORIALOGS_ENDPOINT));

const deploymentsService = new DeploymentsService({ deploymentsRepo: deploymentsRepository });
const appsService = new AppsService({
  appsRepo: appsRepository,
  exportsRepo: exportsRepository,
  artifactStorageRepo: artifactStorageRepository,
  exportStorageRepo: exportStorageRepository,
  appHostDomain: env.APP_HOST_DOMAIN,
});
const exportsService = new ExportsService({
  exportsRepo: exportsRepository,
  storageRepo: exportStorageRepository,
  appsRepo: appsRepository,
  retentionDays: env.EXPORT_RETENTION_DAYS,
});

const assetsService = new AssetsService(assetsRepository);
const healthService = new HealthService(healthRepository);
const filesystemService = new FilesystemService({ deploymentsRepo: deploymentsRepository });
const artifactsService = new ArtifactsService({
  artifactsRepo: artifactsRepository,
  storageRepo: artifactStorageRepository,
  appsRepo: appsRepository,
});
const agentService = new AgentService({
  agentRepo: agentRepository,
  deploymentsService,
  appsService,
  exportsService,
  artifactsService,
});
const logsService = new LogsService({
  logsRepo: logsRepository,
  deploymentsRepo: deploymentsRepository,
});

export function loggerPlugin(name: string) {
  const logger = createLogger(name);
  return new Elysia({ name: `logger.${name}` }).derive({ as: 'scoped' }, () => ({ logger }));
}

export const AssetsServicePlugin = new Elysia({ name: 'service.assets' }).decorate(
  'assetsService',
  assetsService,
);

export const HealthServicePlugin = new Elysia({ name: 'service.health' }).decorate(
  'healthService',
  healthService,
);

export const AgentServicePlugin = new Elysia({ name: 'service.agent' }).decorate(
  'agentService',
  agentService,
);

export const FilesystemServicePlugin = new Elysia({ name: 'service.filesystem' }).decorate(
  'filesystemService',
  filesystemService,
);

export const AppsServicePlugin = new Elysia({ name: 'service.apps' }).decorate(
  'appsService',
  appsService,
);

export const ArtifactsServicePlugin = new Elysia({ name: 'service.artifacts' }).decorate(
  'artifactsService',
  artifactsService,
);

export const DeploymentsServicePlugin = new Elysia({ name: 'service.deployments' }).decorate(
  'deploymentsService',
  deploymentsService,
);

export const LogsServicePlugin = new Elysia({ name: 'service.logs' }).decorate(
  'logsService',
  logsService,
);

export const ExportsServicePlugin = new Elysia({ name: 'service.exports' }).decorate(
  'exportsService',
  exportsService,
);
